// src/sync/firestoreGateway.ts — the real RemoteGateway, and the ONLY file allowed to import
// firebase/firestore (ESLint boundary). Inside it, runTransaction is the only write path:
// no setDoc, updateDoc, addDoc, deleteDoc or writeBatch (ticket 09, guarded by
// firestoreGateway.writePath.test.ts).
//
// Owed at step 5, all built here:
//   - the listener subscribes with `includeMetadataChanges: true`, or an account with no Notes
//     never sees the fromCache → false transition and never gets a complete batch;
//   - `complete` = the first `fromCache === false` snapshot, built from the full `snapshot.docs`
//     (docChanges are relative to an earlier cached snapshot and can omit documents);
//     every other batch is docChanges only, a removal as `doc: null`;
//   - Firestore codes retrying cannot fix become PermanentPushError (`mapPushError`);
//   - `assertWireDoc` runs on the very object handed to `transaction.set`.

import type { FirebaseApp } from 'firebase/app'
import {
  collection,
  connectFirestoreEmulator,
  doc,
  initializeFirestore,
  memoryLocalCache,
  onSnapshot,
  runTransaction,
} from 'firebase/firestore'
import type { DocumentReference, Firestore, Transaction } from 'firebase/firestore'
import { asNoteId } from '../domain/note'
import type { NoteDoc } from '../domain/note'
import type { Flight, PushAction, TransactionRead } from '../domain/reconcile'
import { PermanentPushError, assertWireDoc } from './remoteGateway'
import type { DocChange, PushResult, RemoteGateway, SnapshotBatch, Unsubscribe } from './remoteGateway'

/** Firestore retries a transaction this many times on contention before rejecting. */
const MAX_ATTEMPTS = 5

export interface EmulatorTarget {
  host: string
  port: number
  /** Signs this instance in to the emulator as `uid` (a mock token; emulator only). */
  uid: string
}

/** Memory cache: the mirror is IndexedDB (ticket 03), Firestore's own cache is not relied on. */
export function openFirestore(app: FirebaseApp, opts: { emulator?: EmulatorTarget } = {}): Firestore {
  const db = initializeFirestore(app, { localCache: memoryLocalCache() })
  if (opts.emulator) {
    const { host, port, uid } = opts.emulator
    connectFirestoreEmulator(db, host, port, { mockUserToken: { sub: uid } })
  }
  return db
}

export interface GatewayWriteContext {
  uid: string
  flight: Flight
  attempt: number
  read: TransactionRead
  action: PushAction
}

export interface FirestoreGatewayOptions {
  /** Test seam, same meaning as fakeGateway's: runs after `decide`, before the writes. */
  beforeWrite?: (ctx: GatewayWriteContext) => Promise<void>
}

/**
 * Codes a retry cannot fix. Everything else — `unavailable`, `aborted`, `failed-precondition`
 * (what exhausted contention rejects with), `deadline-exceeded`, `resource-exhausted`,
 * `unauthenticated` (a token refresh fixes it) — stays transient and is retried with backoff.
 */
const PERMANENT = new Set(['permission-denied', 'invalid-argument', 'out-of-range', 'unimplemented'])

/** Only a Firestore error is mapped; anything else (e.g. from `decide`) passes through unchanged. */
export function mapPushError(error: unknown): unknown {
  if (error instanceof Error && error.name === 'FirebaseError') {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && PERMANENT.has(code)) {
      return new PermanentPushError(`Push failed permanently: ${code}`, error)
    }
  }
  return error
}

export function createFirestoreGateway(db: Firestore, opts: FirestoreGatewayOptions = {}): RemoteGateway {
  const noteRef = (uid: string, id: string) => doc(db, 'users', uid, 'notes', id) as DocumentReference<NoteDoc>

  /** The one write call in this file. The guard runs on the object actually handed over. */
  const set = (tx: Transaction, ref: DocumentReference<NoteDoc>, wire: NoteDoc): void => {
    assertWireDoc(wire)
    tx.set(ref, wire)
  }

  return {
    subscribeNotes(uid, onBatch, onError): Unsubscribe {
      let complete = false
      return onSnapshot(
        collection(db, 'users', uid, 'notes'),
        { includeMetadataChanges: true },
        (snapshot) => {
          const fromCache = snapshot.metadata.fromCache
          let batch: SnapshotBatch
          if (!complete && !fromCache) {
            complete = true
            batch = { fromCache, complete: true, changes: snapshot.docs.map((d) => ({ id: asNoteId(d.id), doc: d.data() as NoteDoc })) }
          } else {
            const changes: DocChange[] = snapshot.docChanges().map((c) => ({
              id: asNoteId(c.doc.id),
              doc: c.type === 'removed' ? null : (c.doc.data() as NoteDoc),
            }))
            batch = { fromCache, complete: false, changes }
          }
          onBatch(batch)
        },
        onError,
      )
    },

    async runPush(uid, flight, decide): Promise<PushResult> {
      const noteDoc = noteRef(uid, flight.noteId)
      const copyDoc = noteRef(uid, flight.copyId)
      let attempt = 0
      try {
        return await runTransaction(
          db,
          async (tx) => {
            attempt++
            const [note, copy] = await Promise.all([tx.get(noteDoc), tx.get(copyDoc)])
            const read: TransactionRead = {
              note: note.exists() ? note.data() : null,
              copy: copy.exists() ? copy.data() : null,
            }
            const action = decide(read)
            await opts.beforeWrite?.({ uid, flight, attempt, read, action })
            if (action.kind === 'write') set(tx, noteDoc, action.doc)
            if (action.kind === 'conflictCopy' && action.copy !== null) set(tx, copyDoc, action.copy)
            return { action, read }
          },
          { maxAttempts: MAX_ATTEMPTS },
        )
      } catch (error) {
        throw mapPushError(error)
      }
    },
  }
}
