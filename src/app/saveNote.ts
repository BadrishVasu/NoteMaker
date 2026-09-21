// src/app/saveNote.ts
// The write path, under 02's amendment 2026-09-21 (mathematician): **the editor buffer is a dirty
// row.** Until a change reaches the mirror it exists only here, so the queue carries the two
// things 02's snapshot guard needs to protect it:
//
//   buffer — the full editor content for an open Note (title, titleIsCustom, body, deletedAt)
//   base   — the LocalNote that content derives from. Moved in exactly three places: when the
//            editor seeds from a row (`seed`, `reseed`), after each of this queue's own commits,
//            and on a redirect. Never by a snapshot or a push commit.
//
// Every commit is ONE store transaction inside the shared write lock (the session's, the same one
// the engine uses), reads its row with `tx.get`, and publishes to the corpus before releasing the
// lock. `domain/edit.bufferEdit` decides ordinary vs concurrent. Store before corpus, always: a
// crash between the two loses a re-render, never a keystroke.

import { bufferEdit, newLocalNote, sameVisible } from '../domain/edit'
import { resolveTitle, nextUntitledN } from '../domain/title'
import type { LocalNote, NoteId, Rev } from '../domain/note'
import type { NoteStore } from '../store/noteStore'
import type { Corpus } from '../sync/corpus'

const DEBOUNCE_MS = 600

export interface SaveNoteDeps {
  store: NoteStore
  corpus: Corpus
  /** The session's write lock, shared with the sync engine (02 amendment, rule 2). */
  exclusive: <T>(fn: () => Promise<T>) => Promise<T>
  mintRev: () => Rev
  now: () => number
  /** A local change reached the mirror: wake the engine to push the Outbox. */
  onCommitted?: () => void
}

/** The live (possibly mid-edit) content of an open Note. */
export interface EditPatch {
  title: string
  titleIsCustom: boolean
  body: string
  deletedAt: number | null
}

const contentOf = (row: LocalNote): EditPatch => ({
  title: row.title,
  titleIsCustom: row.titleIsCustom,
  body: row.body,
  deletedAt: row.deletedAt,
})

function untitledNFor(corpus: Corpus): number {
  return nextUntitledN([...corpus.getRows().values()].map((r) => r.title))
}

/** Writes a brand-new Note inside the write lock. Same store-then-corpus order as every commit. */
export async function commitCreate(
  deps: SaveNoteDeps,
  id: NoteId,
  content: { title: string; titleIsCustom: boolean; body: string },
): Promise<LocalNote> {
  const row = await deps.exclusive(async () => {
    const createdAt = deps.now()
    const resolvedTitle = resolveTitle(content, untitledNFor(deps.corpus))
    const created = newLocalNote(
      id,
      { title: resolvedTitle, titleIsCustom: content.titleIsCustom, body: content.body },
      deps.mintRev(),
      createdAt,
    )
    await deps.store.runInTransaction((tx) => tx.put(created))
    deps.corpus.applyWrites([{ op: 'put', row: created }])
    return created
  })
  deps.onCommitted?.()
  return row
}

export interface SaveQueue {
  /** The editor seeded its fields from `row` (mount). Sets `base`; ignored while that Note has a
   *  change pending or a commit queued, whose base must not move. */
  seed(row: LocalNote): void
  /** Queues a change — ONLY the fields that changed — merged into the buffer, never onto the
   *  corpus row, and (re)starts the Note's 600 ms debounce. A caller that can only say what it
   *  changed cannot revert what it didn't (the step-6 title-latch fix). */
  schedule(id: NoteId, change: Partial<EditPatch>): void
  /** Writes now: one Note's pending change, or every pending Note's. Safe with nothing pending. */
  flush(id?: NoteId): void
  /** When the open Note's row now shows other content than `base` and nothing of the user's is
   *  unsaved (rule 5), re-seeds `base` and the buffer from it and returns true: the editor then
   *  remounts on the new row (UI/UX). Otherwise false. */
  reseed(id: NoteId): boolean
  /** Resolves once every commit queued so far has settled. Sign-out flushes, then awaits this. */
  settled(): Promise<void>
  dispose(): void
}

interface OpenNote {
  /** Where this buffer's commits land. Changed by a redirect; read at the start of each commit. */
  id: NoteId
  base: LocalNote
  buffer: EditPatch
  /** A change not yet handed to a commit. */
  dirty: boolean
  timer: ReturnType<typeof setTimeout> | undefined
  /** Commits handed to the lock and not yet settled. */
  queued: number
}

export function createSaveQueue(deps: SaveNoteDeps): SaveQueue {
  const open = new Map<NoteId, OpenNote>()
  /**
   * from → to, for the edit stream that was open when a redirect fired: until the shell
   * re-renders onto `to`, a keystroke can still arrive addressed to `from`, and it must land on the
   * copy — never back on `from`, which now holds the other device's text. The alias serves that
   * stream only (mathematician's review, 2026-09-21): a later deliberate open of `from` is a new
   * stream AT `from`, so `seed` clears it. Kept one hop deep — a redirect repoints every alias
   * that led to its `from`.
   */
  const redirected = new Map<NoteId, NoteId>()
  const inFlight = new Set<Promise<void>>()

  const resolve = (id: NoteId): NoteId => redirected.get(id) ?? id

  function seed(row: LocalNote): void {
    const id = row.id
    redirected.delete(id) // opening a Note starts a new stream at it (see `redirected`)
    const current = open.get(id)
    if (current !== undefined && (current.dirty || current.queued > 0)) return
    if (current?.timer !== undefined) clearTimeout(current.timer)
    open.set(id, { id, base: row, buffer: contentOf(row), dirty: false, timer: undefined, queued: 0 })
  }

  function writeNow(note: OpenNote): void {
    if (note.timer !== undefined) {
      clearTimeout(note.timer)
      note.timer = undefined
    }
    if (!note.dirty) return
    note.dirty = false
    note.queued++
    const snapshot = note.buffer
    const commit = deps
      .exclusive(async () => {
        const id = note.id // resolved at the start of the section, after any redirect (rule 2)
        const title = resolveTitle(snapshot, untitledNFor(deps.corpus))
        const next = await deps.store.runInTransaction(async (tx) => {
          const row = bufferEdit(id, await tx.get(id), note.base, { ...snapshot, title }, deps.mintRev(), deps.now())
          await tx.put(row)
          return row
        })
        deps.corpus.applyWrites([{ op: 'put', row: next }])
        note.base = next
      })
      .then(
        () => deps.onCommitted?.(),
        (err: unknown) => {
          // A failed local write (quota, a row-invariant violation) must be loud. The text is
          // still the buffer; mark it unsaved so the next flush or keystroke retries it.
          console.error(`saveNote: writing Note ${note.id} to the local mirror failed`, err)
          note.dirty = true
        },
      )
      .finally(() => {
        note.queued--
        inFlight.delete(commit)
      })
    inFlight.add(commit)
  }

  const unsubscribe = deps.corpus.subscribeRedirect(({ from, to }) => {
    // Delivered inside the engine's section, after both rows reached the corpus (rule 4).
    for (const [source, target] of redirected) if (target === from) redirected.set(source, to)
    redirected.set(from, to)
    const note = open.get(from)
    if (note === undefined) return
    open.delete(from)
    note.id = to
    const row = deps.corpus.getRow(to)
    if (row !== undefined) note.base = row
    open.set(to, note)
  })

  return {
    seed,
    schedule(id, change) {
      const target = resolve(id)
      if (!open.has(target)) {
        const row = deps.corpus.getRow(target)
        if (row === undefined) return // nothing to edit
        seed(row)
      }
      const note = open.get(target)!
      note.buffer = { ...note.buffer, ...change }
      note.dirty = true
      if (note.timer !== undefined) clearTimeout(note.timer)
      note.timer = setTimeout(() => writeNow(note), DEBOUNCE_MS)
    },
    flush(id) {
      if (id !== undefined) {
        const note = open.get(resolve(id))
        if (note !== undefined) writeNow(note)
        return
      }
      for (const note of [...open.values()]) writeNow(note)
    },
    reseed(id) {
      const note = open.get(resolve(id))
      const row = deps.corpus.getRow(resolve(id))
      if (note === undefined || row === undefined) return false
      if (note.dirty || note.queued > 0 || sameVisible(row, note.base)) return false
      note.base = row
      note.buffer = contentOf(row)
      return true
    },
    async settled() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight])
    },
    dispose() {
      unsubscribe()
      for (const note of open.values()) if (note.timer !== undefined) clearTimeout(note.timer)
    },
  }
}
