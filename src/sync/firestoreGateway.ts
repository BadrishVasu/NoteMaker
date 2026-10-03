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
  persistentLocalCache,
  persistentSingleTabManager,
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

/**
 * Ticket 03, amendment 2026-10-03 (mathematician + designer, on Badrish's question): the SDK cache
 * is **persistent**, single-tab. It is still never read as a data source — the mirror is the only
 * source of truth — but its resume token is what makes a reopen within ~30 minutes bill only the
 * delta instead of the whole collection. Android chops 6–12 real visits into 20–50 launches, so
 * that is the 4–8x saving; past 30 minutes Firestore re-bills the full query by its own rule.
 *
 * `persistentSingleTabManager`: a second tab degrades to today's behaviour with no correctness
 * impact. `persistentMultipleTabManager` is a recorded dead end (firebase-js-sdk #10410).
 *
 * `cache: 'memory'` exists for tests that need the old behaviour; production never passes it. It
 * is a plain string, not a Firestore cache object, because only this file may import
 * firebase/firestore. Nothing here may be read as "the SDK cache is a read surface" — see
 * `subscribeNotes`.
 */
export function openFirestore(
  app: FirebaseApp,
  opts: { emulator?: EmulatorTarget; cache?: 'persistent' | 'memory' } = {},
): Firestore {
  const localCache =
    opts.cache === 'memory'
      ? memoryLocalCache()
      : persistentLocalCache({ tabManager: persistentSingleTabManager(undefined) })
  const db = initializeFirestore(app, { localCache })
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

/** What `mapSnapshot` needs from a Firestore snapshot, so the rule below is testable on its own. */
export interface SnapshotShape {
  fromCache: boolean
  /** The whole collection (`snapshot.docs`). */
  docs: DocChange[]
  /** This delivery's changes (`snapshot.docChanges()`), a removal as `doc: null`. */
  changes: DocChange[]
}

/**
 * One delivery → one `SnapshotBatch`, given whether this subscription has already produced its
 * complete batch. Three cases, and the first is ticket 03's 2026-10-03 drop rule:
 *
 *  1. before the first server-backed snapshot, a from-cache delivery carries NO changes. Under a
 *     persistent cache it holds the SDK's own copy, which may be stale against the mirror, and
 *     applying it walks clean rows backwards. Lossless: case 2 carries the whole collection.
 *  2. the first `fromCache === false` delivery is the complete batch, built from the FULL
 *     collection — never from changes, which are relative to an earlier cached snapshot.
 *  3. everything after it is changes only, including a from-cache delivery: once the server view
 *     has landed, a from-cache delivery is a real local or catch-up update and must be applied.
 *     The rule must not widen to case 3 or those updates are silently dropped.
 */
export function mapSnapshot(snapshot: SnapshotShape, alreadyComplete: boolean): SnapshotBatch {
  const { fromCache } = snapshot
  if (!alreadyComplete && fromCache) return { fromCache, complete: false, changes: [] }
  if (!alreadyComplete) return { fromCache, complete: true, changes: snapshot.docs }
  return { fromCache, complete: false, changes: snapshot.changes }
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
      // Per SUBSCRIPTION, not per gateway: `restartListener()` opens a new one, and its pre-sync
      // window must re-open with it (03's 2026-10-03 amendment makes that required, not accidental).
      let complete = false
      return onSnapshot(
        collection(db, 'users', uid, 'notes'),
        { includeMetadataChanges: true },
        (snapshot) => {
          const batch = mapSnapshot(
            {
              fromCache: snapshot.metadata.fromCache,
              docs: snapshot.docs.map((d) => ({ id: asNoteId(d.id), doc: d.data() as NoteDoc })),
              changes: snapshot.docChanges().map((c) => ({
                id: asNoteId(c.doc.id),
                doc: c.type === 'removed' ? null : (c.doc.data() as NoteDoc),
              })),
            },
            complete,
          )
          if (batch.complete) complete = true
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
