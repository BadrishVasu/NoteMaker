// src/sync/remoteGateway.ts — the port. This file imports nothing from firebase.
// Two implementations: `firestoreGateway.ts` (step 5) and `fakeGateway.ts` (tests).

import type { NoteDoc, NoteId } from '../domain/note'
import type { Flight, PushAction, TransactionRead } from '../domain/reconcile'

export type Unsubscribe = () => void

/** One document's state as the listener reports it. `doc: null` means it is gone. */
export interface DocChange {
  id: NoteId
  doc: NoteDoc | null
}

/**
 * One listener delivery.
 *
 * `fromCache` mirrors Firestore's `metadata.fromCache`: a from-cache delivery is not evidence
 * the transport is up, and it may be EMPTY even with `memoryLocalCache()` when the app opens
 * offline (mathematician, 2026-09-17). Only a server-backed batch resets backoff or wakes pushes.
 *
 * `complete` is true for exactly one batch per subscription: the first with `fromCache === false`,
 * and it carries the FULL collection (`snapshot.docs`, not `docChanges`). Only a complete batch
 * lets the receiver treat a known-but-absent document as gone, stamp `initialSyncCompletedAt`,
 * or mark its session's `lastServerState` as a whole picture. Every other batch carries changes
 * only, removals as `doc: null`.
 */
export interface SnapshotBatch {
  fromCache: boolean
  complete: boolean
  changes: DocChange[]
}

/**
 * A push failure that retrying cannot fix (`permission-denied`, `invalid-argument`, ...).
 * The engine surfaces it and skips that Note until its content changes. Anything else a
 * gateway throws is treated as transient and retried with backoff.
 */
export class PermanentPushError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'PermanentPushError'
  }
}

/** The committed attempt's action and read — never a retried-away attempt's. */
export interface PushResult {
  action: PushAction
  read: TransactionRead
}

export interface RemoteGateway {
  subscribeNotes(uid: string, onBatch: (batch: SnapshotBatch) => void, onError: (error: unknown) => void): Unsubscribe
  /**
   * Runs one transaction over `{flight.noteId, flight.copyId}`: reads both, calls `decide`
   * (pure, re-runnable — it is re-run on contention), writes what the action says, and
   * nothing else. Every object handed to the transaction passes `assertWireDoc` first.
   */
  runPush(uid: string, flight: Flight, decide: (read: TransactionRead) => PushAction): Promise<PushResult>
}

const REQUIRED = ['title', 'titleIsCustom', 'body', 'createdAt', 'updatedAt', 'deletedAt', 'rev'] as const
const OPTIONAL = ['conflictOf', 'conflictBase'] as const
const CONTENT = ['body', 'title', 'titleIsCustom'] as const

const sortedKeys = (o: object): string => Object.keys(o).sort().join(',')

/**
 * The `LocalNote extends NoteDoc` leak guard (`features/sync-engine.md`): asserts the key set
 * of the object actually handed to a transaction — not of `toNoteDoc`'s output, because the
 * leak `extends` permits is a write path that never calls `toNoteDoc` and still typechecks.
 */
export function assertWireDoc(doc: NoteDoc): void {
  const keys = new Set(Object.keys(doc))
  for (const k of REQUIRED) {
    if (!keys.has(k)) throw new Error(`Wire doc is missing required field ${k}.`)
    keys.delete(k)
  }
  for (const k of OPTIONAL) {
    if (!keys.has(k)) continue
    if ((doc as unknown as Record<string, unknown>)[k] === undefined) {
      throw new Error(`Wire doc carries ${k} as undefined; optional fields are omitted, never undefined.`)
    }
    keys.delete(k)
  }
  if (keys.size > 0) throw new Error(`Wire doc carries non-wire field(s): ${[...keys].sort().join(', ')}.`)
  if (doc.conflictBase !== undefined && sortedKeys(doc.conflictBase) !== CONTENT.join(',')) {
    throw new Error(`Wire doc's conflictBase carries ${sortedKeys(doc.conflictBase)}; expected ${CONTENT.join(',')}.`)
  }
}
