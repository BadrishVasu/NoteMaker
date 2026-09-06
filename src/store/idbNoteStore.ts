// src/store/idbNoteStore.ts
// Ticket 03: `idb`, database `notemaker-<uid>`, object stores `notes` (keyPath `id`)
// and `meta` (key-value). No indexes — every read the app performs is a pass over the
// in-memory corpus, so 01's deferred composite-index question resolves to "none".

import { openDB, deleteDB, type IDBPDatabase, type IDBPTransaction } from 'idb'
import type { LocalNote, NoteId } from '../domain/note'
import type { MetaKey, MetaShape, NoteStore, NoteStoreTx } from './noteStore'
import { assertRowInvariant } from './noteStore'

const NOTES = 'notes'
const META = 'meta'
const STORES = [NOTES, META] as const

const dbName = (uid: string): string => `notemaker-${uid}`

type Tx = IDBPTransaction<unknown, typeof STORES, 'readwrite'>

function txSurface(tx: Tx): NoteStoreTx {
  const notes = tx.objectStore(NOTES)
  const meta = tx.objectStore(META)
  return {
    getAll: () => notes.getAll() as Promise<LocalNote[]>,
    get: (id) => notes.get(id) as Promise<LocalNote | undefined>,
    put: async (row) => {
      assertRowInvariant(row)
      await notes.put(row)
    },
    delete: async (id) => {
      await notes.delete(id)
    },
    getMeta: async <K extends MetaKey>(key: K) =>
      (await meta.get(key)) as MetaShape[K] | undefined,
    setMeta: async (key, value) => {
      await meta.put(value, key)
    },
  }
}

export async function openIdbNoteStore(uid: string): Promise<NoteStore> {
  const db: IDBPDatabase = await openDB(dbName(uid), 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(NOTES)) {
        database.createObjectStore(NOTES, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(META)) {
        database.createObjectStore(META)
      }
    },
  })

  /** Every operation, single or batched, goes through one readwrite transaction. A
   *  lone `put` is just a transaction with one write in it. */
  async function inTx<T>(fn: (tx: NoteStoreTx) => Promise<T> | T): Promise<T> {
    const tx = db.transaction(STORES, 'readwrite') as unknown as Tx
    let result: T
    try {
      result = await fn(txSurface(tx))
    } catch (err) {
      // Abort explicitly: a throw before any request would otherwise let the empty
      // transaction commit, and a throw after one would leave earlier writes standing.
      try {
        tx.abort()
      } catch {
        /* already aborted or already finished */
      }
      await tx.done.catch(() => undefined)
      throw err
    }
    await tx.done
    return result
  }

  return {
    getAll: () => inTx((tx) => tx.getAll()),
    get: (id: NoteId) => inTx((tx) => tx.get(id)),
    put: (row: LocalNote) => inTx((tx) => tx.put(row)),
    delete: (id: NoteId) => inTx((tx) => tx.delete(id)),
    getMeta: <K extends MetaKey>(key: K) => inTx((tx) => tx.getMeta(key)),
    setMeta: <K extends MetaKey>(key: K, value: MetaShape[K]) =>
      inTx((tx) => tx.setMeta(key, value)),
    runInTransaction: inTx,
    close: () => db.close(),
  }
}

/** Drops a uid's mirror. Sign-out does NOT call this — 03 keeps the local Notes. */
export async function deleteIdbNoteStore(uid: string): Promise<void> {
  await deleteDB(dbName(uid))
}
