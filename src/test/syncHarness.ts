// src/test/syncHarness.ts
// Test fixture for step 3. NOT the step-4 engine: no I/O, no timers, no gateway — two
// devices and one server driven event-by-event through the real pure units in `domain/`,
// in the Mathematician's own event alphabet (02 appendix 3):
//
//   edit(d,n)  del(d,n)  bpush(d,n)  cpush(d,n)  lose(d,n)  snap(d,n)  purge(n)
//
// bpush runs the transaction atomically (decide + server writes); cpush applies local
// bookkeeping; lose drops the response. Snapshot delivery is k=1 (coalescing): snap
// delivers the server's current state of that document.
//
// The point of the fixture: it REMEMBERS CONTENT PER REV, which is the only way to state
// the lineage property — `baseContent` equals the content this row's `baseRev` was
// written with. `P-INV` (a row-shape check) cannot see it; see noteStore.ts.

import { expect } from 'vitest'
import { asDeviceId, asNoteId, asRev, forkPointOf } from '../domain/note'
import type { DeviceId, ForkPoint, LocalNote, NoteDoc, NoteId, Rev, RowWrite } from '../domain/note'
import { newLocalNote, recordEdit } from '../domain/edit'
import { beginPush, commitPush, decide } from '../domain/reconcile'
import type { Flight, PushAction } from '../domain/reconcile'
import { applySnapshot } from '../domain/applySnapshot'
import { assertRowInvariant } from '../store/noteStore'

const sameContentRows = (a: ForkPoint, b: ForkPoint): boolean =>
  a.title === b.title && a.titleIsCustom === b.titleIsCustom && a.body === b.body

export type Start = 'landed' | 'create'

/**
 * `current` (k=1): snap delivers the server's state now — coalescing.
 * `queued`: every server change is queued per device per document and snap delivers the
 * OLDEST undelivered one — in-order, possibly stale delivery (the Mathematician's k=2 mode,
 * which is where a transaction read is fresher than the listener).
 */
export type Delivery = 'current' | 'queued'

interface Device {
  id: DeviceId
  rows: Map<NoteId, LocalNote>
  /** lastServerState */
  last: Map<NoteId, NoteDoc>
  flights: Map<NoteId, { flight: Flight; action: PushAction }>
  /** Undelivered server states per document (`queued` delivery only). */
  inbox: Map<NoteId, (NoteDoc | null)[]>
}

export interface CopyWrite {
  flight: Flight
  copyId: NoteId
  copy: NoteDoc
}

export const N = asNoteId('N')

export class SyncWorld {
  readonly server = new Map<NoteId, NoteDoc>()
  /** The fixture's reason to exist: every rev ever minted → the content it was minted with. */
  readonly revContent = new Map<Rev, ForkPoint & { deleted: boolean }>()
  /** Each rev's parent — the rev the edit that minted it was typed on top of. */
  private readonly parent = new Map<Rev, Rev | null>()
  /** Every rev that has ever been a server document. */
  private readonly everOnServer = new Set<Rev>()
  readonly devices: Device[]
  readonly copyWrites: CopyWrite[] = []
  private counter = 0

  constructor(start: Start, readonly delivery: Delivery = 'current') {
    this.devices = [0, 1].map((i) => ({
      id: asDeviceId(`dev${i}`),
      rows: new Map(),
      last: new Map(),
      flights: new Map(),
      inbox: new Map(),
    }))
    const c0: ForkPoint = { title: 'Note', titleIsCustom: true, body: 'C0' }
    const r0 = this.mint({ ...c0, deletedAt: null }, null)
    if (start === 'landed') {
      const doc: NoteDoc = { ...c0, createdAt: 0, updatedAt: 0, deletedAt: null, rev: r0 }
      this.serverSet(N, doc)
      for (const d of this.devices) {
        d.last.set(N, doc)
        d.rows.set(N, { ...doc, id: N, baseRev: r0, pendingRev: null, baseContent: null })
      }
    } else {
      this.dev(0).rows.set(N, newLocalNote(N, c0, r0, 0))
    }
    this.check('start')
  }

  // ── events ──────────────────────────────────────────────────────────────────

  edit(d: number, id: NoteId): void {
    const row = this.row(d, id)
    const k = this.counter + 1
    const next = { ...forkPointOf(row), body: `C${k}`, deletedAt: row.deletedAt }
    const rev = this.mint(next, row.rev)
    this.dev(d).rows.set(id, recordEdit(row, next, rev, k))
  }

  /** Toggles Trash: a delete on a live row, a restore on a tombstone. Content unchanged. */
  del(d: number, id: NoteId): void {
    const row = this.row(d, id)
    const k = this.counter + 1
    const next = { ...forkPointOf(row), deletedAt: row.deletedAt === null ? k : null }
    const rev = this.mint(next, row.rev)
    this.dev(d).rows.set(id, recordEdit(row, next, rev, k))
  }

  bpush(d: number, id: NoteId): void {
    const dev = this.dev(d)
    if (dev.flights.has(id)) throw new Error(`bpush(${d},${id}): a push is already in flight`)
    const flight = beginPush(this.row(d, id), dev.id)
    const action = decide(flight, {
      note: this.server.get(id) ?? null,
      copy: this.server.get(flight.copyId) ?? null,
    })
    if (action.kind === 'write') this.serverSet(id, action.doc)
    if (action.kind === 'conflictCopy' && action.copy !== null) {
      this.serverSet(action.copyId, action.copy)
      this.copyWrites.push({ flight, copyId: action.copyId, copy: action.copy })
      this.checkCopyWrite(flight, action.copy)
    }
    dev.flights.set(id, { flight, action })
  }

  cpush(d: number, id: NoteId): void {
    const dev = this.dev(d)
    const f = dev.flights.get(id)
    if (f === undefined) throw new Error(`cpush(${d},${id}): nothing in flight`)
    dev.flights.delete(id)
    const writes = commitPush(
      f.flight,
      f.action,
      { row: dev.rows.get(id), copyRow: dev.rows.get(f.flight.copyId) },
      dev.last.get(id) ?? null,
    )
    this.apply(dev, writes)
  }

  lose(d: number, id: NoteId): void {
    if (!this.dev(d).flights.delete(id)) throw new Error(`lose(${d},${id}): nothing in flight`)
  }

  snap(d: number, id: NoteId): void {
    const dev = this.dev(d)
    let doc: NoteDoc | null
    if (this.delivery === 'current') {
      doc = this.server.get(id) ?? null
    } else {
      const queue = dev.inbox.get(id)
      if (queue === undefined || queue.length === 0) throw new Error(`snap(${d},${id}): nothing queued`)
      doc = queue.shift() ?? null
    }
    this.deliver(dev, id, doc)
  }

  private deliver(dev: Device, id: NoteId, doc: NoteDoc | null): void {
    if (doc === null) dev.last.delete(id)
    else dev.last.set(id, doc)
    this.apply(dev, applySnapshot(dev.rows.get(id), id, doc))
  }

  purge(id: NoteId): void {
    this.server.delete(id)
    this.enqueue(id, null)
  }

  /** Documents with something deliverable to device `d` right now. */
  deliverable(d: number): NoteId[] {
    const dev = this.dev(d)
    if (this.delivery === 'queued') return [...dev.inbox].filter(([, q]) => q.length > 0).map(([id]) => id)
    return [...new Set([...this.server.keys(), ...dev.rows.keys()])]
  }

  private enqueue(id: NoteId, doc: NoteDoc | null): void {
    if (this.delivery !== 'queued') return
    for (const dev of this.devices) {
      const q = dev.inbox.get(id) ?? []
      q.push(doc)
      dev.inbox.set(id, q)
    }
  }

  // ── traces ──────────────────────────────────────────────────────────────────

  /**
   * Runs a trace written exactly as the Mathematician writes them, e.g.
   * `edit(0,N) -> bpush(0,N) -> lose(0,N)`. `copy` names the FIRST Conflict copy written.
   * The full check runs after every step.
   */
  run(trace: string): this {
    for (const raw of trace.split('->').map((s) => s.trim()).filter(Boolean)) {
      const m = /^(\w+)\((?:(\d),)?(\w+)\)$/.exec(raw)
      if (m === null) throw new Error(`Unparseable step: ${raw}`)
      const [, ev, dStr, name] = m as unknown as [string, string, string | undefined, string]
      const id = name === 'copy' ? this.firstCopyId() : asNoteId(name)
      const d = Number(dStr)
      switch (ev) {
        case 'edit': this.edit(d, id); break
        case 'del': this.del(d, id); break
        case 'bpush': this.bpush(d, id); break
        case 'cpush': this.cpush(d, id); break
        case 'lose': this.lose(d, id); break
        case 'snap': this.snap(d, id); break
        case 'purge': this.purge(id); break
        default: throw new Error(`Unknown event: ${ev}`)
      }
      this.check(raw)
    }
    return this
  }

  firstCopyId(): NoteId {
    const first = this.copyWrites[0]
    if (first === undefined) throw new Error('No Conflict copy has been written yet')
    return first.copyId
  }

  // ── properties ──────────────────────────────────────────────────────────────

  contentOf(rev: Rev | null): ForkPoint {
    const c = rev === null ? undefined : this.revContent.get(rev)
    if (c === undefined) throw new Error(`Fixture has no content for rev ${String(rev)}`)
    return forkPointOf(c)
  }

  /** `a` is `b` or one of its ancestors. */
  descends(b: Rev, a: Rev): boolean {
    for (let r: Rev | null | undefined = b; r !== null && r !== undefined; r = this.parent.get(r)) if (r === a) return true
    return false
  }

  /** Same content and same deletedness — what a fast-forward means by "already there". */
  private sameRevContent(a: Rev, b: Rev): boolean {
    const x = this.revContent.get(a)
    const y = this.revContent.get(b)
    return x !== undefined && y !== undefined && x.deleted === y.deleted && sameContentRows(x, y)
  }

  /** P1b — a server write may only destroy content it is descended from. */
  private serverSet(id: NoteId, doc: NoteDoc): void {
    const prev = this.server.get(id)
    if (prev !== undefined && !this.descends(doc.rev, prev.rev)) {
      throw new Error(`P1b: server write ${doc.rev} at ${id} destroys ${prev.rev}, which it does not descend from`)
    }
    this.server.set(id, doc)
    this.enqueue(id, doc)
    this.everOnServer.add(doc.rev)
  }

  /** P-INV, and the lineage property, on every row of every device; plus rev ↔ content. */
  check(at: string): void {
    for (const [i, dev] of this.devices.entries()) {
      for (const row of dev.rows.values()) {
        const where = `after ${at}, device ${i}, row ${row.id}`
        assertRowInvariant(row)
        if (row.baseContent !== null) {
          // THE lineage assertion (02 appendix 3).
          expect(row.baseContent, `lineage ${where}: baseContent vs content at baseRev ${String(row.baseRev)}`).toEqual(
            this.contentOf(row.baseRev),
          )
        }
        const tip = row.pendingRev ?? row.baseRev
        expect(row.rev, `${where}: rev tracks the tip`).toBe(tip)
        expect(forkPointOf(row), `${where}: content vs content at rev ${String(tip)}`).toEqual(this.contentOf(tip))
        if (row.pendingRev === null) expect(row.baseRev, `P-CLEAN ${where}`).not.toBeNull()
      }
    }
    for (const [id, doc] of this.server) {
      expect(forkPointOf(doc), `after ${at}, server ${id}: content vs rev ${doc.rev}`).toEqual(this.contentOf(doc.rev))
    }
  }

  /** P-CB and P-ABS, at the moment a copy is written. */
  private checkCopyWrite(flight: Flight, copy: NoteDoc): void {
    if (flight.baseRev === null) {
      expect('conflictBase' in copy, `P-ABS: copy of a null-base flight ${flight.flightRev}`).toBe(false)
    } else {
      expect(copy.conflictBase, `P-CB: conflictBase of copy ${flight.copyId} vs content at ${flight.baseRev}`).toEqual(
        this.contentOf(flight.baseRev),
      )
    }
  }

  // ── quiescence ──────────────────────────────────────────────────────────────

  /**
   * Drives the world to rest — commit every flight, deliver every document to every device
   * (a full re-read, which is what 03's app open does), push every dirty row — and returns
   * whether it converged: no dirty rows, and each device's mirror equals the server.
   */
  quiesce(maxRounds = 30): boolean {
    for (let round = 0; round < maxRounds; round++) {
      this.devices.forEach((dev, d) => [...dev.flights.keys()].forEach((id) => this.cpush(d, id)))
      this.deliverAll()
      this.check(`quiesce round ${round}`)
      const dirty = this.devices.flatMap((dev, d) =>
        [...dev.rows.values()].filter((r) => r.pendingRev !== null).map((r) => [d, r.id] as const),
      )
      if (dirty.length === 0) return this.converged()
      for (const [d, id] of dirty) {
        this.bpush(d, id)
        this.cpush(d, id)
      }
    }
    return false
  }

  private deliverAll(): void {
    this.devices.forEach((dev, d) => {
      // Drain in order first, then a full re-read (03's app open) of the current state.
      if (this.delivery === 'queued') for (const id of this.deliverable(d)) while ((dev.inbox.get(id)?.length ?? 0) > 0) this.snap(d, id)
      dev.inbox.clear()
    })
    this.devices.forEach((dev, d) => {
      const ids = new Set<NoteId>([...this.server.keys(), ...dev.rows.keys(), ...dev.last.keys()])
      ids.forEach((id) => this.deliver(dev, id, this.server.get(id) ?? null))
      this.check(`full re-read, device ${d}`)
    })
  }

  private converged(): boolean {
    const expected = [...this.server].map(([id, doc]) => ({ ...doc, id, baseRev: doc.rev, pendingRev: null, baseContent: null }))
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)
    return this.devices.every((dev) => {
      try {
        expect([...dev.rows.values()].sort(byId)).toEqual(expected.sort(byId))
        return true
      } catch {
        return false
      }
    })
  }

  // ── plumbing ────────────────────────────────────────────────────────────────

  dev(d: number): Device {
    const dev = this.devices[d]
    if (dev === undefined) throw new Error(`No device ${d}`)
    return dev
  }

  row(d: number, id: NoteId): LocalNote {
    const row = this.dev(d).rows.get(id)
    if (row === undefined) throw new Error(`Device ${d} has no row ${id}`)
    return row
  }

  private mint(content: ForkPoint & { deletedAt: number | null }, parent: Rev | null): Rev {
    const rev = asRev(`R${this.counter++}`)
    this.revContent.set(rev, { ...forkPointOf(content), deleted: content.deletedAt !== null })
    this.parent.set(rev, parent)
    return rev
  }

  /**
   * Applies non-edit writes, then checks P1 locally: a row's tip may only be replaced by
   * something that preserves it — a descendant of it, or identical content, is (or was) on
   * the server (fast-forward: lastServerState may lag the transaction read), it lives on
   * in another local row (Outbox-slot migration), the replacement has the same content, or
   * it was a tombstone (a lost delete is dropped by design, 02).
   */
  private apply(dev: Device, writes: RowWrite[]): void {
    const before = new Map(dev.rows)
    for (const w of writes) {
      if (w.op === 'put') dev.rows.set(w.row.id, w.row)
      else dev.rows.delete(w.id)
    }
    for (const [id, old] of before) {
      const now = dev.rows.get(id)
      if (now !== undefined && now.rev === old.rev) continue
      const tip = old.rev
      const kept =
        this.revContent.get(tip)?.deleted === true ||
        (now !== undefined && now.deletedAt === old.deletedAt && sameContentRows(now, old)) ||
        [...this.everOnServer].some((r) => this.descends(r, tip) || this.sameRevContent(r, tip)) ||
        [...dev.rows.values()].some((r) => this.descends(r.rev, tip))
      if (!kept) throw new Error(`P1: device ${dev.id} row ${id} lost content at ${tip} (now ${String(now?.rev)})`)
    }
  }
}
