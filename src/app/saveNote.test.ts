import { openMemoryNoteStore, deleteMemoryNoteStore } from '../store/memoryNoteStore'
import { createCorpus } from '../sync/corpus'
import { asNoteId, asRev } from '../domain/note'
import type { LocalNote } from '../domain/note'
import { makeRow, resetRows } from '../test/rows'
import { commitCreate, createSaveQueue, type SaveNoteDeps, type SaveQueue } from './saveNote'
import type { NoteStore } from '../store/noteStore'
import type { Corpus } from '../sync/corpus'

// The write path under 02's amendment 2026-09-21 (mathematician): the editor buffer is a dirty
// row. The queue holds, per open Note, `buffer` (full editor content) and `base` (the row it
// derives from); every commit is one store transaction inside the shared write lock, and applies
// onto the stored row only if that row still shows `base`. Push outcomes are pinned end to end
// in src/test/savePath.test.ts; this file pins the queue itself.

/** The same lock shape the session builds (sync/engine.ts `createExclusive`). */
function lock() {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn)
    tail = run.catch(() => undefined)
    return run
  }
}

describe('app/saveNote', () => {
  let store: NoteStore
  let corpus: Corpus
  let deps: SaveNoteDeps
  let queue: SaveQueue
  let rev = 0
  let clock = 1_000
  let committed = 0

  /** An engine-shaped write: a store transaction plus the corpus, inside the lock. */
  const engineWrite = (row: LocalNote) =>
    deps.exclusive(async () => {
      await store.put(row)
      corpus.applyWrites([{ op: 'put', row }])
    })
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
    await queue.settled()
  }
  /** Seeds, as the shell does when the editor mounts, from a row that is in store and corpus. */
  const opened = async (over: Parameters<typeof makeRow>[0] = {}) => {
    const row = makeRow({ title: 'Derived', body: 'Derived', ...over })
    await store.put(row)
    corpus.replaceAll([row])
    queue.seed(row)
    return row
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    resetRows()
    store = await openMemoryNoteStore('save-note-test')
    corpus = createCorpus()
    rev = 0
    clock = 1_000
    committed = 0
    deps = {
      store,
      corpus,
      exclusive: lock(),
      mintRev: () => asRev(`rev-${++rev}`),
      now: () => clock,
      onCommitted: () => committed++,
    }
    queue = createSaveQueue(deps)
  })

  afterEach(async () => {
    queue.dispose()
    vi.useRealTimers()
    store.close()
    await deleteMemoryNoteStore('save-note-test')
  })

  describe('commitCreate', () => {
    it('creates a dirty row with a Default title, store first then corpus, and wakes the engine', async () => {
      const order: string[] = []
      const put = store.runInTransaction.bind(store)
      store.runInTransaction = (fn) => (order.push('store'), put(fn))
      const apply = corpus.applyWrites.bind(corpus)
      corpus.applyWrites = (w) => (order.push('corpus'), apply(w))
      const created = await commitCreate(deps, asNoteId('new-1'), { title: '', titleIsCustom: false, body: '' })
      expect(created.title).toBe('Untitled Note 1')
      expect(created.pendingRev).not.toBeNull()
      expect(await store.get(asNoteId('new-1'))).toEqual(created)
      expect(order).toEqual(['store', 'corpus'])
      expect(committed).toBe(1)
    })

    it('runs inside the write lock', async () => {
      let release!: () => void
      void deps.exclusive(() => new Promise<void>((r) => (release = r)))
      let done = false
      void commitCreate(deps, asNoteId('new-2'), { title: '', titleIsCustom: false, body: '' }).then(() => (done = true))
      await settle()
      expect(done).toBe(false)
      release()
      await vi.waitFor(() => expect(done).toBe(true))
    })
  })

  describe('debounce and flush', () => {
    it('writes once, 600 ms after the last change, resolving the derived title', async () => {
      const row = await opened()
      queue.schedule(row.id, { body: '# Hello world\nmore' })
      vi.advanceTimersByTime(599)
      await settle()
      expect((await store.get(row.id))?.body).toBe('Derived')
      vi.advanceTimersByTime(1)
      await settle()
      const stored = await store.get(row.id)
      expect(stored).toMatchObject({ body: '# Hello world\nmore', title: 'Hello world' })
      expect(stored?.pendingRev).not.toBeNull()
      expect(corpus.getRow(row.id)).toEqual(stored)
      expect(committed).toBe(1)
    })

    it('flush(id) writes now; flush() writes every pending Note; both are no-ops when idle', async () => {
      const a = await opened()
      const b = makeRow()
      await store.put(b)
      corpus.applyWrites([{ op: 'put', row: b }])
      queue.seed(b)
      queue.flush()
      queue.schedule(a.id, { body: 'a1' })
      queue.flush(a.id)
      await settle()
      expect((await store.get(a.id))?.body).toBe('a1')
      queue.schedule(a.id, { body: 'a2' })
      queue.schedule(b.id, { body: 'b1' })
      queue.flush()
      await settle()
      expect((await store.get(a.id))?.body).toBe('a2')
      expect((await store.get(b.id))?.body).toBe('b1')
    })

    it('settled() resolves only after in-flight commits have reached the store (sign-out waits on it)', async () => {
      const row = await opened()
      let release!: () => void
      void deps.exclusive(() => new Promise<void>((r) => (release = r)))
      queue.schedule(row.id, { body: 'last words' })
      queue.flush()
      let done = false
      void queue.settled().then(() => (done = true))
      for (let i = 0; i < 20; i++) await Promise.resolve()
      expect(done).toBe(false)
      release()
      await vi.waitFor(() => expect(done).toBe(true))
      expect((await store.get(row.id))?.body).toBe('last words')
    })
  })

  describe('merging — a change never reverts a field it did not touch', () => {
    it('a body change after a title change keeps the title and the latch', async () => {
      const row = await opened()
      queue.schedule(row.id, { title: 'Mine', titleIsCustom: true })
      queue.schedule(row.id, { body: 'Derived\nmore' })
      queue.flush(row.id)
      await settle()
      expect(await store.get(row.id)).toMatchObject({ title: 'Mine', titleIsCustom: true, body: 'Derived\nmore' })
    })

    it('a body change while the title commit is in flight keeps the title and the latch', async () => {
      const row = await opened()
      queue.schedule(row.id, { title: 'Mine', titleIsCustom: true })
      queue.flush(row.id)
      queue.schedule(row.id, { body: 'typed during the put' })
      queue.flush(row.id)
      await settle()
      expect(await store.get(row.id)).toMatchObject({ title: 'Mine', titleIsCustom: true, body: 'typed during the put' })
    })

    it('a delete in the middle of a typing burst keeps the burst', async () => {
      const row = await opened()
      queue.schedule(row.id, { body: 'typed just before deleting' })
      queue.schedule(row.id, { deletedAt: 5_000 })
      queue.flush(row.id)
      await settle()
      expect(await store.get(row.id)).toMatchObject({ body: 'typed just before deleting', deletedAt: 5_000 })
    })

    it('scheduling for a Note nobody seeded and the corpus does not hold is ignored', () => {
      expect(() => queue.schedule(asNoteId('gone'), { body: 'x' })).not.toThrow()
      expect(() => queue.flush()).not.toThrow()
    })
  })

  describe('the base rule (02 amendment 2026-09-21, rule 3)', () => {
    it('a remote adopt during the debounce makes the flush concurrent: recorded against base, not onto theirs', async () => {
      const row = await opened({ body: 'R0', title: 'R0', rev: asRev('R0'), baseRev: asRev('R0') })
      queue.schedule(row.id, { body: 'R0 + mine' })
      await engineWrite({ ...row, body: 'theirs', title: 'theirs', rev: asRev('S'), baseRev: asRev('S') })
      queue.flush(row.id)
      await settle()
      expect(await store.get(row.id)).toMatchObject({
        body: 'R0 + mine',
        baseRev: asRev('R0'),
        baseContent: { body: 'R0' },
      })
    })

    it('an idle editor adopted underneath: the whole-body keystroke is concurrent (never merged onto the corpus row)', async () => {
      const row = await opened({ body: 'R0', title: 'Kept', titleIsCustom: true, rev: asRev('R0'), baseRev: asRev('R0') })
      await engineWrite({ ...row, body: 'theirs', title: 'Their title', rev: asRev('S'), baseRev: asRev('S') })
      queue.schedule(row.id, { body: 'R0!' })
      queue.flush(row.id)
      await settle()
      expect(await store.get(row.id)).toMatchObject({ body: 'R0!', title: 'Kept', baseRev: asRev('R0') })
    })

    it('an engine commit queued ahead of the edit is read inside the edit transaction: its bookkeeping survives', async () => {
      const row = await opened({ body: 'R0', rev: asRev('R0'), baseRev: asRev('R0') })
      queue.schedule(row.id, { body: 'P1' })
      queue.flush(row.id)
      await settle()
      const p1 = (await store.get(row.id))!
      // The engine's clean-push commit of P1, queued ahead of the next edit.
      void engineWrite({ ...p1, baseRev: p1.pendingRev, pendingRev: null, baseContent: null })
      queue.schedule(row.id, { body: 'P2' })
      queue.flush(row.id)
      await settle()
      expect(await store.get(row.id)).toMatchObject({ body: 'P2', baseRev: p1.rev, baseContent: { body: 'P1' } })
    })

    it('a row that vanished before the flush is recreated dirty, never dropped', async () => {
      const row = await opened({ body: 'R0', rev: asRev('R0'), baseRev: asRev('R0') })
      queue.schedule(row.id, { body: 'still mine' })
      await deps.exclusive(async () => {
        await store.delete(row.id)
        corpus.applyWrites([{ op: 'delete', id: row.id }])
      })
      queue.flush(row.id)
      await settle()
      expect(await store.get(row.id)).toMatchObject({ body: 'still mine', baseRev: asRev('R0') })
      expect(corpus.getRow(row.id)?.body).toBe('still mine')
    })

    it('a failed commit keeps the text and the next flush retries it', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const row = await opened()
      const real = store.runInTransaction.bind(store)
      store.runInTransaction = () => Promise.reject(new Error('QuotaExceededError'))
      queue.schedule(row.id, { body: 'do not lose me' })
      queue.flush(row.id)
      await settle()
      expect(spy).toHaveBeenCalled()
      store.runInTransaction = real
      queue.flush(row.id)
      await settle()
      expect((await store.get(row.id))?.body).toBe('do not lose me')
      spy.mockRestore()
    })
  })

  describe('redirect (rule 4): the buffer follows the text to the copy', () => {
    const COPY = asNoteId('copy-1')
    /** The engine's conflict commit: `from` adopts theirs, the copy row holds our content. */
    const conflict = (from: LocalNote, ours: LocalNote) =>
      deps.exclusive(async () => {
        const adopted = { ...from, body: 'theirs', rev: asRev('S'), baseRev: asRev('S'), pendingRev: null, baseContent: null }
        const copy = { ...ours, id: COPY, baseRev: ours.pendingRev, pendingRev: null, baseContent: null }
        await store.put(adopted)
        await store.put(copy)
        corpus.applyWrites([{ op: 'put', row: adopted }, { op: 'put', row: copy }])
        corpus.redirect(from.id, COPY)
      })

    it('a pending debounce flushes to the copy as an ordinary edit; the other device’s text at `from` is untouched', async () => {
      const row = await opened({ body: 'R0', rev: asRev('R0'), baseRev: asRev('R0') })
      queue.schedule(row.id, { body: 'P1' })
      queue.flush(row.id)
      await settle()
      const p1 = (await store.get(row.id))!
      queue.schedule(row.id, { body: 'P1 and more' })
      await conflict(row, p1)
      vi.advanceTimersByTime(600)
      await settle()
      expect((await store.get(row.id))?.body).toBe('theirs')
      expect(await store.get(COPY)).toMatchObject({ body: 'P1 and more', baseRev: p1.rev, baseContent: { body: 'P1' } })
    })

    it('an edit commit queued behind the redirecting commit resolves its target at the start of its section', async () => {
      const row = await opened({ body: 'R0', rev: asRev('R0'), baseRev: asRev('R0') })
      queue.schedule(row.id, { body: 'P1' })
      queue.flush(row.id)
      await settle()
      const p1 = (await store.get(row.id))!
      const redirecting = conflict(row, p1) // queued first
      queue.schedule(row.id, { body: 'P1 then P2' })
      queue.flush(row.id) // queued behind it, while the target was still `from`
      await redirecting
      await settle()
      expect((await store.get(row.id))?.body).toBe('theirs')
      expect((await store.get(COPY))?.body).toBe('P1 then P2')
    })

    it('a keystroke still addressed to `from` after the redirect goes to the copy', async () => {
      const row = await opened({ body: 'R0', rev: asRev('R0'), baseRev: asRev('R0') })
      queue.schedule(row.id, { body: 'P1' })
      queue.flush(row.id)
      await settle()
      await conflict(row, (await store.get(row.id))!)
      queue.schedule(row.id, { body: 'P1 typed before the shell re-rendered' })
      queue.flush(row.id)
      await settle()
      expect((await store.get(row.id))?.body).toBe('theirs')
      expect((await store.get(COPY))?.body).toBe('P1 typed before the shell re-rendered')
    })
  })

  // Mathematician's review, 2026-09-21: the alias serves the edit stream that was open when the
  // redirect fired, not the Note id. Opening `from` later starts a new stream AT `from`.
  describe('the redirect alias is per edit stream, not per Note id', () => {
    const COPY = asNoteId('copy-a')
    const redirectTo = async (from: LocalNote, to: LocalNote) =>
      deps.exclusive(async () => {
        await store.put(to)
        corpus.applyWrites([{ op: 'put', row: to }])
        corpus.redirect(from.id, to.id)
      })

    it('opening `from` after a redirect edits `from`, and leaves the idle copy byte-identical', async () => {
      const row = await opened({ body: 'R0', rev: asRev('R0'), baseRev: asRev('R0') })
      const copy = { ...row, id: COPY, body: 'our conflicted text' }
      await redirectTo(row, copy)
      queue.seed(corpus.getRow(row.id)!) // the user taps the original Note in the list
      queue.schedule(row.id, { body: 'R0 edited deliberately' })
      queue.flush()
      await settle()
      expect((await store.get(row.id))?.body).toBe('R0 edited deliberately')
      expect(await store.get(COPY)).toEqual(copy)
    })

    it('opening `from` while the copy has a commit queued: the copy’s text survives', async () => {
      const row = await opened({ body: 'R0', rev: asRev('R0'), baseRev: asRev('R0') })
      const copy = { ...row, id: COPY, body: 'our conflicted text' }
      await redirectTo(row, copy)
      queue.schedule(COPY, { body: 'our conflicted text, continued' }) // copy dirty
      queue.seed(corpus.getRow(row.id)!)
      queue.schedule(row.id, { body: 'R0 edited deliberately' })
      queue.flush()
      await settle()
      expect((await store.get(COPY))?.body).toBe('our conflicted text, continued')
      expect((await store.get(row.id))?.body).toBe('R0 edited deliberately')
    })

    it('a chain a → b → c: a stale keystroke for `a` lands at `c`; reopening `b` edits `b`', async () => {
      const a = await opened({ id: 'a', body: 'A', rev: asRev('RA'), baseRev: asRev('RA') })
      const b = { ...a, id: asNoteId('b'), body: 'A' }
      const c = { ...a, id: asNoteId('c'), body: 'A' }
      await redirectTo(a, b)
      await redirectTo(b, c)
      queue.seed(corpus.getRow(asNoteId('b'))!)
      queue.schedule(a.id, { body: 'A, stale keystroke' })
      queue.schedule(asNoteId('b'), { body: 'B, deliberately' })
      queue.flush()
      await settle()
      expect((await store.get(asNoteId('c')))?.body).toBe('A, stale keystroke')
      expect((await store.get(asNoteId('b')))?.body).toBe('B, deliberately')
      expect((await store.get(a.id))?.body).toBe('A')
    })
  })

  describe('re-seeding the open editor (rule 5; UI/UX: silently, as a remount)', () => {
    const remote = (row: LocalNote, body: string) =>
      engineWrite({ ...row, body, rev: asRev(`S-${body}`), baseRev: asRev(`S-${body}`), pendingRev: null, baseContent: null })

    it('idle: re-seeds to the new row, and the next edit is ordinary onto it', async () => {
      const row = await opened({ body: 'R0', rev: asRev('R0'), baseRev: asRev('R0') })
      await remote(row, 'theirs')
      expect(queue.reseed(row.id)).toBe(true)
      queue.schedule(row.id, { body: 'theirs + mine' })
      queue.flush(row.id)
      await settle()
      expect(await store.get(row.id)).toMatchObject({ body: 'theirs + mine', baseRev: asRev('S-theirs') })
    })

    it('never while a change is pending or a commit is queued', async () => {
      const row = await opened({ body: 'R0', rev: asRev('R0'), baseRev: asRev('R0') })
      queue.schedule(row.id, { body: 'typing' })
      await remote(row, 'theirs')
      expect(queue.reseed(row.id)).toBe(false)
      let release!: () => void
      void deps.exclusive(() => new Promise<void>((r) => (release = r)))
      queue.flush(row.id)
      expect(queue.reseed(row.id)).toBe(false)
      for (let i = 0; i < 20; i++) await Promise.resolve()
      release()
      await settle()
    })

    it('not when only the rev moved (our own push, a fast-forward adopt)', async () => {
      const row = await opened({ body: 'R0', rev: asRev('R0'), baseRev: asRev('R0') })
      await engineWrite({ ...row, rev: asRev('FF'), baseRev: asRev('FF') })
      expect(queue.reseed(row.id)).toBe(false)
    })
  })
})
