// src/sync/fakeGateway.ts — the in-memory server ticket 09 runs its devices against.
// One FakeServer is the shared backend; each device's engine gets its own `gateway()`.
//
// Faithful where the engine's correctness depends on it, and nowhere else:
//   - a push is an optimistic transaction over {noteId, copyId}: read, decide, then commit
//     only if neither read document changed meanwhile; otherwise re-run decide (Firestore
//     re-executes the callback), at most five attempts;
//   - `beforeWrite` is the interleaving hook between a transaction's read and its write;
//   - the listener delivers asynchronously, coalesces per document, can be held back to lag
//     the transaction reads, and starts with a complete batch;
//   - nothing crosses the wire by reference.

import type { NoteDoc, NoteId } from '../domain/note'
import type { Flight, PushAction, TransactionRead } from '../domain/reconcile'
import { assertWireDoc } from './remoteGateway'
import type { PushResult, RemoteGateway, SnapshotBatch, Unsubscribe } from './remoteGateway'

const MAX_ATTEMPTS = 5

const clone = <T>(v: T): T => structuredClone(v)

export interface WriteContext {
  uid: string
  flight: Flight
  attempt: number
  read: TransactionRead
  action: PushAction
}

interface Subscription {
  uid: string
  onBatch: (batch: SnapshotBatch) => void
  complete: boolean
  pending: Map<NoteId, NoteDoc | null>
  active: boolean
}

export class FakeServer {
  private readonly users = new Map<string, Map<NoteId, NoteDoc>>()
  private readonly versions = new Map<string, number>()
  private readonly subscriptions: Subscription[] = []
  private held = false

  /** Interleaving hook: runs after `decide`, before the commit check. May await. */
  beforeWrite: ((ctx: WriteContext) => void | Promise<void>) | null = null
  /** While set, every push rejects with it before reading — the transport is down. */
  failPushesWith: unknown = null
  /** Every object a committed transaction was handed, by reference: the leak guard's subject. */
  readonly handed: { uid: string; id: NoteId; doc: NoteDoc }[] = []
  /** How many listeners have been opened, ever. */
  subscriptionsOpened = 0
  /** How many pushes have started, per note id. */
  readonly pushesStarted = new Map<NoteId, number>()

  // ── the server, as the test and "other clients" see it ─────────────────────────

  doc(uid: string, id: NoteId): NoteDoc | undefined {
    const d = this.users.get(uid)?.get(id)
    return d === undefined ? undefined : clone(d)
  }

  ids(uid: string): NoteId[] {
    return [...(this.users.get(uid)?.keys() ?? [])]
  }

  /** A write by some other client, outside any push. */
  put(uid: string, id: NoteId, doc: NoteDoc): void {
    this.write(uid, id, clone(doc))
  }

  /** A removal — a purge, or a deletion by some other client. */
  remove(uid: string, id: NoteId): void {
    if (this.users.get(uid)?.delete(id) !== true) return
    this.bump(uid, id)
    this.notify(uid, id, null)
  }

  // ── the listener's timing ─────────────────────────────────────────────────────

  /** Queue deliveries instead of sending them — the listener lags the transactions. */
  hold(): void {
    this.held = true
  }

  release(): void {
    this.held = false
    this.scheduleFlush()
  }

  /** Lets every queued microtask (deliveries, store transactions, commits) run out. */
  async settle(rounds = 3): Promise<void> {
    for (let i = 0; i < rounds; i++) await new Promise<void>((resolve) => setImmediate(resolve))
  }

  /** Delivers a hand-built batch to every active listener of `uid`, now — e.g. the empty
   *  from-cache batch Firestore sends when the app opens offline. */
  emit(uid: string, batch: SnapshotBatch): void {
    for (const sub of this.subscriptions) if (sub.active && sub.uid === uid) sub.onBatch(clone(batch))
  }

  gateway(): RemoteGateway {
    return {
      subscribeNotes: (uid, onBatch) => this.subscribe(uid, onBatch),
      runPush: (uid, flight, decide) => this.runPush(uid, flight, decide),
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────────

  private subscribe(uid: string, onBatch: (batch: SnapshotBatch) => void): Unsubscribe {
    const sub: Subscription = {
      uid,
      onBatch,
      complete: true,
      pending: new Map(this.users.get(uid) ?? []),
      active: true,
    }
    this.subscriptions.push(sub)
    this.subscriptionsOpened++
    this.scheduleFlush()
    return () => {
      sub.active = false
    }
  }

  private async runPush(uid: string, flight: Flight, decide: (read: TransactionRead) => PushAction): Promise<PushResult> {
    this.pushesStarted.set(flight.noteId, (this.pushesStarted.get(flight.noteId) ?? 0) + 1)
    await Promise.resolve()
    if (this.failPushesWith !== null) throw this.failPushesWith

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const before = [this.version(uid, flight.noteId), this.version(uid, flight.copyId)]
      const read: TransactionRead = {
        note: this.doc(uid, flight.noteId) ?? null,
        copy: this.doc(uid, flight.copyId) ?? null,
      }
      const action = decide(read)
      await this.beforeWrite?.({ uid, flight, attempt, read, action })
      if (this.failPushesWith !== null) throw this.failPushesWith
      if (before[0] !== this.version(uid, flight.noteId) || before[1] !== this.version(uid, flight.copyId)) continue

      const writes: [NoteId, NoteDoc][] = []
      if (action.kind === 'write') writes.push([flight.noteId, action.doc])
      if (action.kind === 'conflictCopy' && action.copy !== null) writes.push([action.copyId, action.copy])
      for (const [, doc] of writes) assertWireDoc(doc) // all or nothing, as the rules would deny
      for (const [id, doc] of writes) {
        this.handed.push({ uid, id, doc })
        this.write(uid, id, clone(doc))
      }
      return { action, read }
    }
    throw new Error(`FakeServer: transaction contention on ${flight.noteId}; ${MAX_ATTEMPTS} attempts exhausted.`)
  }

  private write(uid: string, id: NoteId, doc: NoteDoc): void {
    let docs = this.users.get(uid)
    if (docs === undefined) this.users.set(uid, (docs = new Map()))
    docs.set(id, doc)
    this.bump(uid, id)
    this.notify(uid, id, doc)
  }

  private version(uid: string, id: NoteId): number {
    return this.versions.get(`${uid}/${id}`) ?? 0
  }

  private bump(uid: string, id: NoteId): void {
    this.versions.set(`${uid}/${id}`, this.version(uid, id) + 1)
  }

  private notify(uid: string, id: NoteId, doc: NoteDoc | null): void {
    for (const sub of this.subscriptions) if (sub.active && sub.uid === uid) sub.pending.set(id, doc)
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    queueMicrotask(() => this.flush())
  }

  private flush(): void {
    if (this.held) return
    for (const sub of this.subscriptions) {
      if (!sub.active || (!sub.complete && sub.pending.size === 0)) continue
      const batch: SnapshotBatch = {
        fromCache: false,
        complete: sub.complete,
        changes: [...sub.pending].map(([id, doc]) => ({ id, doc: clone(doc) })),
      }
      sub.complete = false
      sub.pending = new Map()
      sub.onBatch(batch)
    }
  }
}
