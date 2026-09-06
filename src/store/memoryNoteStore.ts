// src/store/memoryNoteStore.ts
// The fake. Same contract suite as `idbNoteStore`, and deliberately no laxer: it clones
// on the way in and on the way out, it enforces the row invariant, and it survives a
// close, because ticket 09 simulates a second device as a second store instance.

import type { LocalNote, NoteId } from '../domain/note'
import type { MetaKey, MetaShape, NoteStore, NoteStoreTx } from './noteStore'
import { assertRowInvariant } from './noteStore'

interface Backing {
  notes: Map<NoteId, LocalNote>
  meta: Map<MetaKey, MetaShape[MetaKey]>
}

/** Keyed by uid exactly as the IndexedDB database name is, so that "reopen the same
 *  device" and "open a different device" are the same distinction in both stores. */
const backings = new Map<string, Backing>()

const backingFor = (uid: string): Backing => {
  let b = backings.get(uid)
  if (b === undefined) {
    b = { notes: new Map(), meta: new Map() }
    backings.set(uid, b)
  }
  return b
}

/**
 * `structuredClone` is what IndexedDB itself does, so using it here keeps one behaviour
 * the fake could otherwise get wrong for free: a caller that mutates a row it read must
 * not change what is stored.
 */
const clone = <T>(v: T): T => structuredClone(v)

function makeTx(b: Backing): NoteStoreTx {
  return {
    getAll: async () => [...b.notes.values()].map(clone),
    get: async (id) => {
      const row = b.notes.get(id)
      return row === undefined ? undefined : clone(row)
    },
    put: async (row) => {
      assertRowInvariant(row)
      b.notes.set(row.id, clone(row))
    },
    delete: async (id) => {
      b.notes.delete(id)
    },
    getMeta: async <K extends MetaKey>(key: K) =>
      b.meta.get(key) as MetaShape[K] | undefined,
    setMeta: async (key, value) => {
      b.meta.set(key, value)
    },
  }
}

export async function openMemoryNoteStore(uid: string): Promise<NoteStore> {
  const b = backingFor(uid)
  const tx = makeTx(b)
  return {
    ...tx,
    runInTransaction: async (fn) => {
      // Rollback by snapshot-and-restore. The maps hold at most the whole corpus, which
      // ticket 03 already keeps in memory in its entirety, so this costs one shallow
      // copy of a structure the app is holding anyway.
      const notes = new Map(b.notes)
      const meta = new Map(b.meta)
      try {
        return await fn(makeTx(b))
      } catch (err) {
        b.notes = notes
        b.meta = meta
        throw err
      }
    },
    close: () => {},
  }
}

/** Drops a simulated device's storage entirely. Tests and nothing else. */
export async function deleteMemoryNoteStore(uid: string): Promise<void> {
  backings.delete(uid)
}
