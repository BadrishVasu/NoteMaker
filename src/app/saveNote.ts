// src/app/saveNote.ts
// The write path. architecture.md: resolve title (domain/title), mint pendingRev, store.put(row)
// FIRST, then update the corpus. Store before corpus, always: a crash between the two must lose a
// re-render, never a keystroke. `domain/edit` and `domain/title` do the pure part; this is the
// edge, so it mints the rev and the timestamp.

import { recordEdit, newLocalNote } from '../domain/edit'
import { resolveTitle, nextUntitledN } from '../domain/title'
import type { LocalNote, NoteId, Rev } from '../domain/note'
import type { NoteStore } from '../store/noteStore'
import type { Corpus } from '../sync/corpus'

const DEBOUNCE_MS = 600

export interface SaveNoteDeps {
  store: NoteStore
  corpus: Corpus
  mintRev: () => Rev
  now: () => number
}

/** The live (possibly mid-edit) content a keystroke produces. */
export interface EditPatch {
  title: string
  titleIsCustom: boolean
  body: string
  deletedAt: number | null
}

function untitledNFor(corpus: Corpus): number {
  return nextUntitledN([...corpus.getRows().values()].map((r) => r.title))
}

/**
 * Writes one edit to an existing row. Resolves the title, mints a rev, writes the store, and
 * only then updates the corpus.
 */
export async function commitEdit(
  deps: SaveNoteDeps,
  row: LocalNote,
  patch: EditPatch,
): Promise<LocalNote> {
  const resolvedTitle = resolveTitle(
    { title: patch.title, titleIsCustom: patch.titleIsCustom, body: patch.body },
    untitledNFor(deps.corpus),
  )
  const next = recordEdit(
    row,
    {
      title: resolvedTitle,
      titleIsCustom: patch.titleIsCustom,
      body: patch.body,
      deletedAt: patch.deletedAt,
    },
    deps.mintRev(),
    deps.now(),
  )
  await deps.store.put(next)
  // Step 7 seam: sync/engine.ts will observe writes like this one and push the Outbox. No
  // engine exists at step 6, so there is nothing to wake here — this comment is the seam.
  deps.corpus.applyWrites([{ op: 'put', row: next }])
  return next
}

/** Writes a brand-new Note. Same store-then-corpus order as `commitEdit`. */
export async function commitCreate(
  deps: SaveNoteDeps,
  id: NoteId,
  content: { title: string; titleIsCustom: boolean; body: string },
): Promise<LocalNote> {
  const createdAt = deps.now()
  const resolvedTitle = resolveTitle(content, untitledNFor(deps.corpus))
  const row = newLocalNote(
    id,
    { title: resolvedTitle, titleIsCustom: content.titleIsCustom, body: content.body },
    deps.mintRev(),
    createdAt,
  )
  await deps.store.put(row)
  deps.corpus.applyWrites([{ op: 'put', row }])
  return row
}

export interface SaveQueue {
  /**
   * Queues a change to Note `id` — ONLY the fields that changed — and (re)starts its ~600ms
   * debounce. The change is merged onto the freshest content the queue knows of for that Note:
   * the not-yet-flushed patch, else the content of its latest in-flight commit, else the live
   * corpus row. Never onto a row captured at render time.
   *
   * Why this shape (builder, step 6 review): the previous `schedule(row, fullPatch)` REPLACED the
   * pending patch, and each caller built its full patch from the corpus row, which lags the
   * debounce and lags again for the length of a `store.put`. A body keystroke landing inside
   * either window after a title keystroke carried the OLD title and `titleIsCustom: false`, so
   * the typed title vanished and the one-way latch silently reversed. A caller that can only say
   * what it changed cannot revert what it didn't.
   */
  schedule(id: NoteId, change: Partial<EditPatch>): void
  /** Writes now: one Note's pending patch when `id` is given, otherwise every pending Note's.
   *  Called by `platform/lifecycle.ts` and on Editor unmount. Safe to call with nothing pending. */
  flush(id?: NoteId): void
}

const contentOf = (row: LocalNote): EditPatch => ({
  title: row.title,
  titleIsCustom: row.titleIsCustom,
  body: row.body,
  deletedAt: row.deletedAt,
})

/** One debounced save queue per open corpus. Debounces per Note, so typing in one Note never
 *  delays another's flush. */
export function createSaveQueue(deps: SaveNoteDeps): SaveQueue {
  const timers = new Map<NoteId, ReturnType<typeof setTimeout>>()
  const pending = new Map<NoteId, EditPatch>()
  /** The content of the most recent commit handed to the chain and not yet settled. Covers the
   *  window where the corpus row is stale because `store.put` has not resolved. */
  const inFlight = new Map<NoteId, EditPatch>()
  /** One promise chain per Note, so two commits of the same Note run strictly in order and each
   *  reads its base row only after the previous one reached the corpus. */
  const chains = new Map<NoteId, Promise<void>>()

  function writeNow(id: NoteId): void {
    const patch = pending.get(id)
    if (patch === undefined) return
    pending.delete(id)
    const timer = timers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.delete(id)
    }
    inFlight.set(id, patch)
    const link = (chains.get(id) ?? Promise.resolve())
      .then(async () => {
        const row = deps.corpus.getRow(id)
        if (row === undefined) return // the Note left the corpus (purged); nothing to edit
        await commitEdit(deps, row, patch)
      })
      .catch((err: unknown) => {
        // A failed local write (quota, a row-invariant violation) must be loud. The text is still
        // in the editor's buffer, and the chain stays usable so the next keystroke retries.
        console.error(`saveNote: writing Note ${id} to the local mirror failed`, err)
      })
      .finally(() => {
        if (inFlight.get(id) === patch) inFlight.delete(id)
        if (chains.get(id) === link) chains.delete(id)
      })
    chains.set(id, link)
  }

  return {
    schedule(id, change) {
      const row = deps.corpus.getRow(id)
      const base = pending.get(id) ?? inFlight.get(id) ?? (row !== undefined ? contentOf(row) : undefined)
      if (base === undefined) return // not in the corpus and nothing queued: nothing to edit
      pending.set(id, { ...base, ...change })
      const existing = timers.get(id)
      if (existing !== undefined) clearTimeout(existing)
      timers.set(
        id,
        setTimeout(() => writeNow(id), DEBOUNCE_MS),
      )
    },
    flush(id) {
      if (id !== undefined) {
        writeNow(id)
        return
      }
      for (const key of [...pending.keys()]) writeNow(key)
    },
  }
}
