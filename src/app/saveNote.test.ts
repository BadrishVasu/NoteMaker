import { openMemoryNoteStore, deleteMemoryNoteStore } from '../store/memoryNoteStore'
import { createCorpus } from '../sync/corpus'
import { asNoteId, asRev } from '../domain/note'
import { makeRow, resetRows } from '../test/rows'
import { commitEdit, commitCreate, createSaveQueue, type SaveNoteDeps } from './saveNote'
import type { NoteStore } from '../store/noteStore'
import type { Corpus } from '../sync/corpus'

describe('app/saveNote', () => {
  let store: NoteStore
  let corpus: Corpus
  let deps: SaveNoteDeps
  let rev = 0
  let clock = 1_000

  beforeEach(async () => {
    resetRows()
    store = await openMemoryNoteStore('save-note-test')
    corpus = createCorpus()
    rev = 0
    clock = 1_000
    deps = {
      store,
      corpus,
      mintRev: () => asRev(`rev-${++rev}`),
      now: () => clock,
    }
  })

  afterEach(async () => {
    store.close()
    await deleteMemoryNoteStore('save-note-test')
  })

  it('writes the store before the corpus sees the change', async () => {
    const row = makeRow({ title: 'Note 1', body: 'Note 1', baseRev: asRev('r0'), rev: asRev('r0') })
    corpus.replaceAll([row])

    const order: string[] = []
    const originalPut = store.put.bind(store)
    store.put = async (r) => {
      order.push('store')
      await originalPut(r)
    }
    const originalApply = corpus.applyWrites.bind(corpus)
    corpus.applyWrites = (writes) => {
      order.push('corpus')
      originalApply(writes)
    }

    await commitEdit(deps, row, { title: '', titleIsCustom: false, body: 'edited', deletedAt: null })
    expect(order).toEqual(['store', 'corpus'])
  })

  it('resolves a derived title from the body before saving', async () => {
    const row = makeRow({ title: 'Note 1', body: 'Note 1', baseRev: asRev('r0'), rev: asRev('r0') })
    const next = await commitEdit(deps, row, {
      title: '',
      titleIsCustom: false,
      body: '# Hello world\nmore text',
      deletedAt: null,
    })
    expect(next.title).toBe('Hello world')
    expect(next.pendingRev).not.toBeNull()
    const stored = await store.get(row.id)
    expect(stored?.title).toBe('Hello world')
  })

  it('creates a new row with a Default title when the body is empty', async () => {
    const created = await commitCreate(deps, asNoteId('new-1'), {
      title: '',
      titleIsCustom: false,
      body: '',
    })
    expect(created.title).toBe('Untitled Note 1')
    expect(created.pendingRev).not.toBeNull()
    expect(await store.get(asNoteId('new-1'))).toEqual(created)
  })

  describe('createSaveQueue', () => {
    it('debounces and flushes a single write after the timer fires', async () => {
      vi.useFakeTimers()
      const row = makeRow({ baseRev: asRev('r0'), rev: asRev('r0') })
      corpus.replaceAll([row])
      const queue = createSaveQueue(deps)

      queue.schedule(row.id, { body: 'a' })
      queue.schedule(row.id, { body: 'ab' })
      queue.schedule(row.id, { body: 'abc' })

      await vi.advanceTimersByTimeAsync(600)
      const stored = await store.get(row.id)
      expect(stored?.body).toBe('abc')
      vi.useRealTimers()
    })

    it('flush(id) writes immediately without waiting for the timer', async () => {
      const row = makeRow({ baseRev: asRev('r0'), rev: asRev('r0') })
      corpus.replaceAll([row])
      const queue = createSaveQueue(deps)
      queue.schedule(row.id, { body: 'flushed' })
      queue.flush(row.id)
      // commitEdit is async; give the microtask queue a turn.
      await Promise.resolve()
      await Promise.resolve()
      const stored = await store.get(row.id)
      expect(stored?.body).toBe('flushed')
    })

    it('flush() with no id flushes every pending Note', async () => {
      const rowA = makeRow({ baseRev: asRev('ra'), rev: asRev('ra') })
      const rowB = makeRow({ baseRev: asRev('rb'), rev: asRev('rb') })
      corpus.replaceAll([rowA, rowB])
      const queue = createSaveQueue(deps)
      queue.schedule(rowA.id, { body: 'A' })
      queue.schedule(rowB.id, { body: 'B' })
      queue.flush()
      await Promise.resolve()
      await Promise.resolve()
      expect((await store.get(rowA.id))?.body).toBe('A')
      expect((await store.get(rowB.id))?.body).toBe('B')
    })

    it('flush is a harmless no-op when nothing is pending', () => {
      const queue = createSaveQueue(deps)
      expect(() => queue.flush()).not.toThrow()
      expect(() => queue.flush(asNoteId('nothing-pending'))).not.toThrow()
    })

    // Builder, step 6 review. `schedule` used to REPLACE the pending patch, and each input handler
    // built its patch from the corpus row — which lags the debounce. Title then body inside 600ms
    // meant the body patch (old title, titleIsCustom:false) overwrote the title patch: the typed
    // title vanished and the one-way latch silently reversed, while the uncontrolled input kept
    // showing what the user typed. A change now carries only the fields it changes, and the queue
    // merges it onto the freshest content it knows of.
    describe('merging — a change never reverts a field it did not touch', () => {
      const flushed = async (): Promise<void> => {
        for (let i = 0; i < 10; i++) await Promise.resolve()
      }

      it('a body change after a title change, inside the debounce, keeps the title and the latch', async () => {
        const row = makeRow({ title: 'Derived', body: 'Derived', baseRev: asRev('r0'), rev: asRev('r0') })
        corpus.replaceAll([row])
        const queue = createSaveQueue(deps)

        queue.schedule(row.id, { title: 'Mine', titleIsCustom: true })
        queue.schedule(row.id, { body: 'Derived\nmore' })
        queue.flush(row.id)
        await flushed()

        const stored = await store.get(row.id)
        expect(stored?.title).toBe('Mine')
        expect(stored?.titleIsCustom).toBe(true)
        expect(stored?.body).toBe('Derived\nmore')
      })

      it('a body change while the title commit is still in flight keeps the title and the latch', async () => {
        // The blur-flush window: the title is flushed (commit started, corpus not yet updated
        // because store.put has not resolved), and the user is already typing in the body.
        const row = makeRow({ title: 'Derived', body: 'Derived', baseRev: asRev('r0'), rev: asRev('r0') })
        corpus.replaceAll([row])
        const queue = createSaveQueue(deps)

        queue.schedule(row.id, { title: 'Mine', titleIsCustom: true })
        queue.flush(row.id)
        expect(corpus.getRow(row.id)?.title).toBe('Derived') // commit genuinely still in flight
        queue.schedule(row.id, { body: 'typed during the put' })
        queue.flush(row.id)
        await flushed()

        const stored = await store.get(row.id)
        expect(stored?.title).toBe('Mine')
        expect(stored?.titleIsCustom).toBe(true)
        expect(stored?.body).toBe('typed during the put')
        expect(corpus.getRow(row.id)?.titleIsCustom).toBe(true)
      })

      it('a delete in the middle of a typing burst keeps the burst', async () => {
        const row = makeRow({ baseRev: asRev('r0'), rev: asRev('r0') })
        corpus.replaceAll([row])
        const queue = createSaveQueue(deps)

        queue.schedule(row.id, { body: 'typed just before deleting' })
        queue.schedule(row.id, { deletedAt: 5_000 })
        queue.flush(row.id)
        await flushed()

        const stored = await store.get(row.id)
        expect(stored?.body).toBe('typed just before deleting')
        expect(stored?.deletedAt).toBe(5_000)
      })

      it('with nothing pending, a change builds on the live corpus row', async () => {
        const row = makeRow({ title: 'Kept', titleIsCustom: true, baseRev: asRev('r0'), rev: asRev('r0') })
        corpus.replaceAll([row])
        const queue = createSaveQueue(deps)

        queue.schedule(row.id, { body: 'new body' })
        queue.flush(row.id)
        await flushed()

        const stored = await store.get(row.id)
        expect(stored?.title).toBe('Kept')
        expect(stored?.titleIsCustom).toBe(true)
      })

      it('scheduling for a Note the corpus does not hold is ignored, not a crash', () => {
        const queue = createSaveQueue(deps)
        expect(() => queue.schedule(asNoteId('gone'), { body: 'x' })).not.toThrow()
        expect(() => queue.flush()).not.toThrow()
      })
    })
  })
})
