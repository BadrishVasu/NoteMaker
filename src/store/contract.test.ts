import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { asDeviceId, asNoteId, asRev } from '../domain/note'
import type { LocalNote } from '../domain/note'
import type { NoteStore } from './noteStore'
import { openMemoryNoteStore, deleteMemoryNoteStore } from './memoryNoteStore'
import { openIdbNoteStore, deleteIdbNoteStore } from './idbNoteStore'

/**
 * Ticket 03's `NoteStore` port: `getAll`, `get`, `put`, `delete`, `runInTransaction`,
 * plus the `meta` key-value store. ONE suite, run against the in-memory fake and
 * against the real `idb` implementation, because ticket 09 simulates a second device
 * as a second store instance and the fake must not be a laxer store than the real one.
 *
 * Where `idb` runs on `fake-indexeddb` here: that is a faithful implementation of the
 * IndexedDB semantics this suite exercises (structured clone, key uniqueness, abort on
 * throw). It is NOT a substitute for the emulator, which ticket 03 keeps for real
 * Firestore transaction semantics. Nothing in this suite depends on wall-clock timing
 * or on IndexedDB's auto-commit-at-end-of-turn behaviour, which is where a fake would
 * be least trustworthy.
 */

let n = 0
const nextId = () => asNoteId(`note-${++n}`)

/** A clean row: nothing pending, no base content. */
function cleanRow(overrides: Partial<LocalNote> = {}): LocalNote {
  return {
    id: nextId(),
    title: 'Groceries',
    titleIsCustom: true,
    body: '- oat milk',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    deletedAt: null,
    rev: asRev('r1'),
    baseRev: asRev('r1'),
    pendingRev: null,
    baseContent: null,
    ...overrides,
  }
}

/** A dirty row against a real base: `pendingRev`, `baseRev` and `baseContent` all set. */
function dirtyRow(overrides: Partial<LocalNote> = {}): LocalNote {
  return cleanRow({
    pendingRev: asRev('r2'),
    baseContent: { title: 'Groceries', titleIsCustom: true, body: '' },
    ...overrides,
  })
}

interface Harness {
  readonly name: string
  open(): Promise<NoteStore>
  reset(): Promise<void>
}

const harnesses: Harness[] = [
  {
    name: 'memoryNoteStore',
    // Opened by uid exactly as `idb` is, and it survives a close: ticket 09 simulates a
    // second device as a second store instance, and a device that forgets everything when
    // its tab closes is not a device. Same reason both are `open`/`delete` shaped.
    open: () => openMemoryNoteStore('uid-under-test'),
    reset: () => deleteMemoryNoteStore('uid-under-test'),
  },
  {
    name: 'idbNoteStore',
    open: () => openIdbNoteStore('uid-under-test'),
    reset: () => deleteIdbNoteStore('uid-under-test'),
  },
]

for (const harness of harnesses) {
  describe(`NoteStore contract — ${harness.name}`, () => {
    let store: NoteStore

    beforeEach(async () => {
      await harness.reset()
      store = await harness.open()
    })

    afterEach(async () => {
      store.close()
      await harness.reset()
    })

    describe('notes: get / put / getAll / delete', () => {
      it('is empty to begin with', async () => {
        expect(await store.getAll()).toEqual([])
      })

      it('returns undefined for an unknown id', async () => {
        expect(await store.get(asNoteId('nope'))).toBeUndefined()
      })

      it('round-trips a row', async () => {
        const row = cleanRow()
        await store.put(row)
        expect(await store.get(row.id)).toEqual(row)
      })

      it('returns every row from getAll', async () => {
        const a = cleanRow()
        const b = cleanRow()
        await store.put(a)
        await store.put(b)
        const all = await store.getAll()
        expect(all).toHaveLength(2)
        expect(all.map((r) => r.id).sort()).toEqual([a.id, b.id].sort())
      })

      it('overwrites by id rather than appending — one row, one atomic put', async () => {
        const row = cleanRow()
        await store.put(row)
        await store.put({ ...row, body: 'changed' })
        const all = await store.getAll()
        expect(all).toHaveLength(1)
        expect(all[0]?.body).toBe('changed')
      })

      it('deletes a row', async () => {
        const row = cleanRow()
        await store.put(row)
        await store.delete(row.id)
        expect(await store.get(row.id)).toBeUndefined()
        expect(await store.getAll()).toEqual([])
      })

      it('treats deleting an absent row as a no-op', async () => {
        await expect(store.delete(asNoteId('nope'))).resolves.toBeUndefined()
      })

      it('hands out copies, not aliases — mutating a read row cannot corrupt the store', async () => {
        // `idb` structured-clones on the way out; a fake backed by a Map would hand back
        // the live object, so the two stores would disagree about whether an accidental
        // mutation in the corpus reaches disk. Pinned so the fake cannot be laxer.
        const row = cleanRow()
        await store.put(row)
        const read = await store.get(row.id)
        read!.body = 'mutated in place'
        expect((await store.get(row.id))?.body).toBe('- oat milk')
      })

      it('hands out copies from getAll too', async () => {
        // Not redundant with the test above: `getAll` is the read the corpus is built
        // from on every app open, so it is the one whose rows the UI actually holds.
        const row = cleanRow()
        await store.put(row)
        const [read] = await store.getAll()
        read!.body = 'mutated in place'
        expect((await store.getAll())[0]?.body).toBe('- oat milk')
      })

      it('does not capture the caller’s object on put either', async () => {
        const row = cleanRow()
        await store.put(row)
        row.body = 'mutated after put'
        expect((await store.get(row.id))?.body).toBe('- oat milk')
      })
    })

    describe('optional wire fields survive the round trip as ABSENT, not undefined', () => {
      // `conflictOf` / `conflictBase` are absent rather than null on an ordinary Note
      // (01's closed allowlist). A store that resurrects them as present-but-undefined
      // makes `toNoteDoc` emit `conflictOf: undefined`, which Firestore throws on inside
      // a transaction, presenting as a failed push.
      it('an ordinary Note comes back with neither key present', async () => {
        const row = cleanRow()
        await store.put(row)
        const read = await store.get(row.id)
        expect('conflictOf' in read!).toBe(false)
        expect('conflictBase' in read!).toBe(false)
      })

      it('a Conflict copy round-trips both fields intact', async () => {
        const row = cleanRow({
          conflictOf: asNoteId('parent'),
          conflictBase: { title: 'Groceries', titleIsCustom: true, body: 'old' },
        })
        await store.put(row)
        const read = await store.get(row.id)
        expect(read?.conflictOf).toBe(asNoteId('parent'))
        expect(read?.conflictBase).toEqual({ title: 'Groceries', titleIsCustom: true, body: 'old' })
      })
    })

    describe('the baseContent invariant', () => {
      // architecture.md, "The one thing the tickets were missing":
      //   baseContent !== null  iff  pendingRev !== null && baseRev !== null
      // Enforced by the store on every write so that a violating row cannot reach disk
      // by any path, rather than asserted only on rows the test itself constructed.
      it('accepts a clean row with no baseContent', async () => {
        await expect(store.put(cleanRow())).resolves.toBeUndefined()
      })

      it('accepts a dirty row against a real base, carrying baseContent', async () => {
        await expect(store.put(dirtyRow())).resolves.toBeUndefined()
      })

      it('accepts an unlanded create: dirty, no baseRev, no baseContent', async () => {
        const row = cleanRow({ baseRev: null, pendingRev: asRev('r2'), baseContent: null })
        await expect(store.put(row)).resolves.toBeUndefined()
      })

      it('rejects a dirty row against a real base with no baseContent — the capture was missed', async () => {
        const row = dirtyRow({ baseContent: null })
        await expect(store.put(row)).rejects.toThrow(/baseContent/)
      })

      it('rejects a clean row that still carries baseContent — the clear was missed', async () => {
        const row = cleanRow({
          baseContent: { title: 'Groceries', titleIsCustom: true, body: '' },
        })
        await expect(store.put(row)).rejects.toThrow(/baseContent/)
      })

      it('rejects an unlanded create carrying baseContent — there is no fork point to hold', async () => {
        const row = dirtyRow({ baseRev: null })
        await expect(store.put(row)).rejects.toThrow(/baseContent/)
      })

      it('does not write the rejected row', async () => {
        const row = dirtyRow({ baseContent: null })
        await expect(store.put(row)).rejects.toThrow()
        expect(await store.get(row.id)).toBeUndefined()
      })

      it('rejects inside a transaction, and the whole transaction rolls back', async () => {
        const good = cleanRow()
        const bad = dirtyRow({ baseContent: null })
        await expect(
          store.runInTransaction(async (tx) => {
            await tx.put(good)
            await tx.put(bad)
          }),
        ).rejects.toThrow(/baseContent/)
        expect(await store.getAll()).toEqual([])
      })
    })

    describe('meta', () => {
      it('returns undefined for a key never written', async () => {
        expect(await store.getMeta('initialSyncCompletedAt')).toBeUndefined()
      })

      it('round-trips each of the three keys', async () => {
        await store.setMeta('initialSyncCompletedAt', 1_700_000_000_000)
        await store.setMeta('deviceId', asDeviceId('a1b2c3d4'))
        await store.setMeta('persistGranted', false)
        expect(await store.getMeta('initialSyncCompletedAt')).toBe(1_700_000_000_000)
        expect(await store.getMeta('deviceId')).toBe(asDeviceId('a1b2c3d4'))
        expect(await store.getMeta('persistGranted')).toBe(false)
      })

      it('distinguishes a stored false from an unset key', async () => {
        // Empty mirror + unset flag renders *loading*; empty mirror + set flag renders
        // the genuine first-run empty state (03). Conflating the two shows a new device
        // "you have no notes" while its first sync is still in flight.
        expect(await store.getMeta('persistGranted')).toBeUndefined()
        await store.setMeta('persistGranted', false)
        expect(await store.getMeta('persistGranted')).toBe(false)
      })

      it('overwrites an existing key', async () => {
        await store.setMeta('persistGranted', false)
        await store.setMeta('persistGranted', true)
        expect(await store.getMeta('persistGranted')).toBe(true)
      })
    })

    describe('runInTransaction', () => {
      it('returns the callback’s value', async () => {
        expect(await store.runInTransaction(async () => 42)).toBe(42)
      })

      it('commits several note writes together', async () => {
        const a = cleanRow()
        const b = cleanRow()
        await store.runInTransaction(async (tx) => {
          await tx.put(a)
          await tx.put(b)
        })
        expect(await store.getAll()).toHaveLength(2)
      })

      it('reads its own writes inside the transaction', async () => {
        const row = cleanRow()
        const seen = await store.runInTransaction(async (tx) => {
          await tx.put(row)
          return tx.get(row.id)
        })
        expect(seen?.id).toBe(row.id)
      })

      it('rolls every note write back when the callback throws', async () => {
        const a = cleanRow()
        const b = cleanRow()
        await store.put(a)
        await expect(
          store.runInTransaction(async (tx) => {
            await tx.put(b)
            await tx.delete(a.id)
            throw new Error('boom')
          }),
        ).rejects.toThrow('boom')
        const all = await store.getAll()
        expect(all).toHaveLength(1)
        expect(all[0]?.id).toBe(a.id)
      })

      it('spans notes and meta — the first snapshot lands as one write', async () => {
        // 03: the full corpus arrives in one `onSnapshot` and is written in one
        // transaction, with `initialSyncCompletedAt` set by that same transaction.
        // Split in two, a crash between them renders a genuine empty account.
        const row = cleanRow()
        await store.runInTransaction(async (tx) => {
          await tx.put(row)
          await tx.setMeta('initialSyncCompletedAt', 1_700_000_000_000)
        })
        expect(await store.getAll()).toHaveLength(1)
        expect(await store.getMeta('initialSyncCompletedAt')).toBe(1_700_000_000_000)
      })

      it('rolls meta back with the notes', async () => {
        const row = cleanRow()
        await expect(
          store.runInTransaction(async (tx) => {
            await tx.put(row)
            await tx.setMeta('initialSyncCompletedAt', 1_700_000_000_000)
            throw new Error('boom')
          }),
        ).rejects.toThrow('boom')
        expect(await store.getAll()).toEqual([])
        expect(await store.getMeta('initialSyncCompletedAt')).toBeUndefined()
      })

      it('sees writes made before it and is visible to reads after it', async () => {
        const a = cleanRow()
        await store.put(a)
        await store.runInTransaction(async (tx) => {
          const read = await tx.get(a.id)
          expect(read?.id).toBe(a.id)
          await tx.put({ ...a, body: 'edited' })
        })
        expect((await store.get(a.id))?.body).toBe('edited')
      })

      it('exposes getAll inside the transaction', async () => {
        const a = cleanRow()
        await store.put(a)
        const all = await store.runInTransaction((tx) => tx.getAll())
        expect(all).toHaveLength(1)
      })
    })

    describe('durability across a close and reopen', () => {
      it('keeps what was written', async () => {
        const row = cleanRow()
        await store.put(row)
        await store.setMeta('deviceId', asDeviceId('a1b2c3d4'))
        store.close()
        store = await harness.open()
        expect((await store.get(row.id))?.body).toBe('- oat milk')
        expect(await store.getMeta('deviceId')).toBe(asDeviceId('a1b2c3d4'))
      })
    })
  })
}
