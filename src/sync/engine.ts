// src/sync/engine.ts — the loop. Sequences the pure units in `domain/` against a store and a
// gateway, and derives no row itself: every RowWrite comes from `applySnapshot` or `commitPush`.
//
// Owns: the per-Note in-flight gate, backoff, the per-push timeout, `lastServerState`, and the
// choice of adopt view it hands `commitPush`. Consults no clock and never reads
// `navigator.onLine` — time arrives as `deps.clock`, connectivity as snapshot delivery.
//
// Sequencing rulings (mathematician, 2026-09-17, on Builder's questions):
//   - The adopt view is chosen at COMMIT time, inside the engine's exclusive section:
//     `lastServerState` (absent = gone) once THIS SESSION's listener has applied a complete
//     batch; the transaction read before that. The persisted `initialSyncCompletedAt` does not
//     decide it — the map is in-memory and empty at every session start.
//   - Only a server-backed batch (`fromCache === false`) is complete, resets backoff or wakes.
//   - A push that times out is surfaced but keeps its Note gated until the gateway settles:
//     releasing it would let two flights from this device race on one Note, which the model
//     never checked and which writes spurious Conflict copies of the user's own text.
//   - `lastServerState` changes only after the snapshot's store transaction committed; a failed
//     apply resubscribes, which resets the session.

import { applySnapshot } from '../domain/applySnapshot'
import { ConflictCopyIdTooLongError } from '../domain/conflictCopy'
import type { DeviceId, LocalNote, NoteDoc, NoteId, Rev, RowWrite } from '../domain/note'
import { asDeviceId } from '../domain/note'
import { beginPush, commitPush, decide } from '../domain/reconcile'
import type { NoteStore, NoteStoreTx } from '../store/noteStore'
import { PermanentPushError } from './remoteGateway'
import type { DocChange, RemoteGateway, SnapshotBatch, Unsubscribe } from './remoteGateway'

export const BACKOFF_MIN_MS = 1_000
export const BACKOFF_MAX_MS = 60_000
export const PUSH_TIMEOUT_MS = 10_000

export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export type SyncProblem =
  | { kind: 'push-failed'; noteId: NoteId; permanent: boolean; error: unknown }
  | { kind: 'push-timeout'; noteId: NoteId }
  | { kind: 'conflict-copy-id-too-long'; noteId: NoteId; error: ConflictCopyIdTooLongError }
  | { kind: 'snapshot-failed'; error: unknown }
  | { kind: 'listener-failed'; error: unknown }
  /** The Outbox could not be read from the store. Retried on backoff. */
  | { kind: 'drain-failed'; error: unknown }

export interface SyncEngineDeps {
  uid: string
  store: NoteStore
  gateway: RemoteGateway
  clock: Clock
  /** The `Auto sync` setting. Off: only `syncNow` begins pushes. It never gates the mirror. */
  autoSync?: () => boolean
  /** Source for a first-run `deviceId`; 8 characters are kept. */
  randomId?: () => string
  onProblem?: (problem: SyncProblem) => void
}

export interface SyncEngine {
  /** Reads (or mints) the deviceId, then subscribes. */
  start(): Promise<void>
  stop(): void
  /** A local edit, or `visibilitychange → visible`. */
  wake(): void
  /** The `Sync Now` button: resets backoff and drains, whatever `Auto sync` says. */
  syncNow(): void
}

type Trigger = 'auto' | 'manual'

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const { uid, gateway, clock } = deps
  const autoSync = deps.autoSync ?? (() => true)
  const report = (p: SyncProblem) => deps.onProblem?.(p)

  let running = false
  let deviceId: DeviceId | null = null
  let unsubscribe: Unsubscribe | null = null
  /** Bumped per subscription; a batch still queued from a torn-down listener is dropped. */
  let generation = 0

  /** Last delivered document per Note, whole. In-memory, this session only (02 defect 1). */
  const lastServerState = new Map<NoteId, NoteDoc>()
  /** This session's listener has applied a complete batch: the map is a whole picture. */
  let sessionComplete = false

  /** One in-flight push per Note. Drains skip a gated Note; they never await it. */
  const inFlight = new Map<NoteId, Promise<boolean>>()
  /** Notes that failed permanently, by the pendingRev that failed. Cleared by a new edit. */
  const stuck = new Map<NoteId, Rev>()

  let backoffMs = BACKOFF_MIN_MS
  let backoffTimer: unknown = null

  /** Snapshot applies and push commits run one at a time: a commit must never read
   *  `lastServerState` between a snapshot's row writes and its map update. */
  let exclusiveTail: Promise<unknown> = Promise.resolve()
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = exclusiveTail.then(fn, fn)
    exclusiveTail = run.catch(() => undefined)
    return run
  }

  const applyWrites = async (tx: NoteStoreTx, writes: RowWrite[]) => {
    for (const w of writes) {
      if (w.op === 'put') await tx.put(w.row)
      else await tx.delete(w.id)
    }
  }

  // ── backoff ─────────────────────────────────────────────────────────────────────

  /** The retry is an automatic wake: with `Auto sync` off it re-subscribes but pushes nothing. */
  function armBackoff(): void {
    if (!running || backoffTimer !== null) return
    const delay = backoffMs
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS)
    backoffTimer = clock.setTimeout(() => {
      backoffTimer = null
      if (unsubscribe === null) subscribe()
      drain('auto')
    }, delay)
  }

  function resetBackoff(): void {
    backoffMs = BACKOFF_MIN_MS
    if (backoffTimer !== null) clock.clearTimeout(backoffTimer)
    backoffTimer = null
  }

  // ── the listener ────────────────────────────────────────────────────────────────

  function subscribe(): void {
    const mine = ++generation
    unsubscribe = gateway.subscribeNotes(uid, (batch) => onBatch(batch, mine), (error) => {
      report({ kind: 'listener-failed', error })
      restartListener()
    })
  }

  function restartListener(): void {
    unsubscribe?.()
    unsubscribe = null
    generation++
    sessionComplete = false
    lastServerState.clear()
    armBackoff() // the timer resubscribes
  }

  function onBatch(batch: SnapshotBatch, from: number): void {
    void exclusive(async () => {
      if (from !== generation) return false
      await applyBatch(batch)
      return true
    }).then(
      (applied) => {
        if (!applied || batch.fromCache || !running) return
        resetBackoff()
        drain('auto')
      },
      (error: unknown) => {
        if (!running) return
        report({ kind: 'snapshot-failed', error })
        restartListener()
      },
    )
  }

  async function applyBatch(batch: SnapshotBatch): Promise<void> {
    let changes: DocChange[] = batch.changes
    await deps.store.runInTransaction(async (tx) => {
      if (batch.complete) {
        // Everything known but absent from the whole collection is gone.
        const present = new Set(changes.map((c) => c.id))
        const known = new Set<NoteId>([...(await tx.getAll()).map((r) => r.id), ...lastServerState.keys()])
        changes = [...changes, ...[...known].filter((id) => !present.has(id)).map((id) => ({ id, doc: null }))]
      }
      for (const { id, doc } of changes) await applyWrites(tx, applySnapshot(await tx.get(id), id, doc))
      if (batch.complete && (await tx.getMeta('initialSyncCompletedAt')) == null) {
        await tx.setMeta('initialSyncCompletedAt', clock.now())
      }
    })
    // Committed: only now does the map learn what the store already reflects.
    for (const { id, doc } of changes) {
      if (doc === null) lastServerState.delete(id)
      else lastServerState.set(id, doc)
    }
    if (batch.complete) sessionComplete = true
  }

  // ── pushing ─────────────────────────────────────────────────────────────────────

  function drain(trigger: Trigger): void {
    if (!running || deviceId === null) return
    if (trigger === 'auto' && !autoSync()) return
    void deps.store.getAll().then(
      (rows) => {
        for (const row of rows) {
          if (row.pendingRev === null || inFlight.has(row.id) || stuck.get(row.id) === row.pendingRev) continue
          startPush(row.id, trigger)
        }
      },
      (error: unknown) => {
        report({ kind: 'drain-failed', error })
        armBackoff()
      },
    )
  }

  function startPush(noteId: NoteId, trigger: Trigger): void {
    const flightDone = push(noteId).finally(() => inFlight.delete(noteId))
    inFlight.set(noteId, flightDone)
    void flightDone.then((committed) => {
      if (committed) drain(trigger) // typing during the flight, or a migrated copy row
    })
  }

  /** Resolves true when a push result was committed locally. Never rejects. */
  async function push(noteId: NoteId): Promise<boolean> {
    let row: LocalNote | undefined
    try {
      row = await deps.store.get(noteId)
    } catch (error) {
      report({ kind: 'push-failed', noteId, permanent: false, error })
      armBackoff()
      return false
    }
    if (!running || deviceId === null || row === undefined || row.pendingRev === null) return false
    if (stuck.get(noteId) === row.pendingRev) return false
    stuck.delete(noteId)

    let flight
    try {
      flight = beginPush(row, deviceId)
    } catch (error) {
      // Deterministic in the row: retrying the same pendingRev cannot succeed.
      stuck.set(noteId, row.pendingRev)
      if (error instanceof ConflictCopyIdTooLongError) report({ kind: 'conflict-copy-id-too-long', noteId, error })
      else report({ kind: 'push-failed', noteId, permanent: true, error })
      return false
    }

    // Surfaces a slow push; deliberately does NOT release the gate (see the header).
    const timer = clock.setTimeout(() => report({ kind: 'push-timeout', noteId }), PUSH_TIMEOUT_MS)

    try {
      const f = flight
      const result = await gateway.runPush(uid, f, (read) => decide(f, read))
      clock.clearTimeout(timer)
      await exclusive(() =>
        deps.store.runInTransaction(async (tx) => {
          const local = { row: await tx.get(noteId), copyRow: await tx.get(f.copyId) }
          const view = sessionComplete ? (lastServerState.get(noteId) ?? null) : result.read.note
          await applyWrites(tx, commitPush(f, result.action, local, view))
        }),
      )
      backoffMs = BACKOFF_MIN_MS // a success proves the transport; an armed retry is left alone
      return true
    } catch (error) {
      clock.clearTimeout(timer)
      const permanent = error instanceof PermanentPushError
      if (permanent) stuck.set(noteId, row.pendingRev)
      report({ kind: 'push-failed', noteId, permanent, error })
      if (!permanent) armBackoff()
      return false
    }
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────────

  return {
    async start() {
      if (running) return
      running = true
      let id = await deps.store.getMeta('deviceId')
      if (id === undefined) {
        id = asDeviceId((deps.randomId ?? (() => crypto.randomUUID()))().slice(0, 8))
        await deps.store.setMeta('deviceId', id)
      }
      deviceId = id
      subscribe()
      drain('auto')
    },
    stop() {
      running = false
      unsubscribe?.()
      unsubscribe = null
      resetBackoff()
    },
    wake() {
      drain('auto')
    },
    syncNow() {
      resetBackoff()
      drain('manual')
    },
  }
}
