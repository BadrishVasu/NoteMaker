import { describe, it, expect } from 'vitest'
import { N, SyncWorld } from './syncHarness'
import type { Delivery, Start } from './syncHarness'

/**
 * Step 3's lineage assertion and 02 appendix 3's Gaps A, B and C, over the fixture that
 * remembers content per rev. Each gap's test body IS the Mathematician's trace, run through
 * the real `domain/` units; `SyncWorld.check` asserts P-INV, the lineage property, and
 * rev ↔ content after every step, and P-CB / P-ABS at every copy write.
 *
 * `P-INV` is a shape check. It is not what these tests rest on: in Gap C's trace the broken
 * row satisfies it. The lineage assertion is what fails.
 */

describe('Gap A — already-landed branch must capture baseContent', () => {
  it('edit(0,N) -> bpush(0,N) -> lose(0,N) -> bpush(0,N) -> edit(0,N) -> cpush(0,N)', () => {
    const w = new SyncWorld('landed').run(
      'edit(0,N) -> bpush(0,N) -> lose(0,N) -> bpush(0,N) -> edit(0,N) -> cpush(0,N)',
    )
    const row = w.row(0, N)
    expect(w.dev(0).flights.size).toBe(0)
    expect(row.pendingRev).not.toBeNull()
    expect(row.baseRev).toBe(w.server.get(N)?.rev) // advanced by the landed retry
    expect(row.baseContent).toEqual(w.contentOf(row.baseRev))
  })
})

describe('Gap B — the first landing of an unlanded create', () => {
  it('bpush(0,N) -> edit(0,N) -> cpush(0,N), from the create start state', () => {
    const w = new SyncWorld('create').run('bpush(0,N) -> edit(0,N) -> cpush(0,N)')
    const row = w.row(0, N)
    expect(row.baseRev).not.toBeNull()
    expect(row.pendingRev).not.toBeNull()
    expect(row.baseContent).toEqual(w.contentOf(row.baseRev))
  })
})

describe('Gap C — conflict-branch Outbox-slot migration', () => {
  const PREFIX = 'edit(0,N) -> bpush(0,N) -> edit(1,N) -> bpush(1,N) -> edit(1,N)'

  it(`${PREFIX} -> cpush(1,N): the migrated copy row's baseContent is the in-flight content, not C0`, () => {
    const w = new SyncWorld('landed').run(`${PREFIX} -> cpush(1,N)`)
    const copyId = w.firstCopyId()
    const migrated = w.row(1, copyId)
    const flight = w.copyWrites[0]!.flight
    expect(migrated.baseRev).toBe(flight.flightRev)
    expect(migrated.pendingRev).not.toBeNull()
    expect(migrated.baseContent).toEqual(w.contentOf(flight.flightRev))
    expect(migrated.baseContent).not.toEqual(w.contentOf(flight.baseRev)) // the stale C0
  })

  it(
    `${PREFIX} -> snap(0,copy) -> edit(0,copy) -> bpush(0,copy) -> edit(1,N) -> cpush(1,N) -> bpush(1,copy): ` +
      'the copy-of-copy carries the right conflictBase',
    () => {
      const w = new SyncWorld('landed').run(
        `${PREFIX} -> snap(0,copy) -> edit(0,copy) -> bpush(0,copy) -> edit(1,N) -> cpush(1,N) -> bpush(1,copy)`,
      )
      // Device 0 edited the copy, so device 1's push of it conflicts and writes a copy of
      // the copy. Its conflictBase must be the first copy's content at its flight rev —
      // two generations newer than C0, the value the broken design wrote.
      expect(w.copyWrites).toHaveLength(2)
      const [first, second] = w.copyWrites as [(typeof w.copyWrites)[0], (typeof w.copyWrites)[0]]
      expect(second.flight.noteId).toBe(first.copyId)
      expect(second.copy.conflictOf).toBe(first.copyId)
      expect(second.copy.conflictBase).toEqual(w.contentOf(first.flight.flightRev))
      expect(second.copy.conflictBase).not.toEqual(w.contentOf(first.flight.baseRev))
    },
  )
})

describe('02 appendix, cell 7 — retained baseContent is later written as a correct conflictBase', () => {
  it('purge while dirty, another device recreates, our push conflicts with the retained fork point', () => {
    // Device 0 is dirty at R0 when the doc is purged; the snapshot is a no-op (cell 7).
    // Device 1 still holds a dirty edit from R0 and recreates the doc. Device 0's push
    // then conflicts, and the copy's conflictBase is the retained R0 content.
    const w = new SyncWorld('landed').run(
      'edit(0,N) -> edit(1,N) -> purge(N) -> snap(0,N) -> bpush(1,N) -> cpush(1,N) -> bpush(0,N)',
    )
    expect(w.copyWrites).toHaveLength(1)
    expect(w.copyWrites[0]!.copy.conflictBase).toEqual(w.contentOf(w.copyWrites[0]!.flight.baseRev))
  })
})

describe('02 appendix, accepted behaviour — delete-lost discards edits made before the delete', () => {
  it('edit then delete offline, their edit wins: our pre-delete text is gone, by design', () => {
    const w = new SyncWorld('landed').run(
      'edit(0,N) -> del(0,N) -> edit(1,N) -> bpush(1,N) -> cpush(1,N) -> snap(0,N) -> bpush(0,N) -> cpush(0,N)',
    )
    expect(w.copyWrites).toHaveLength(0)
    const row = w.row(0, N)
    expect(row.pendingRev).toBeNull()
    expect(row.deletedAt).toBeNull()
    expect(row.body).toBe(w.server.get(N)?.body)
  })
})

/**
 * Seeded random walks over the whole alphabet: both start states, purge on and off, and both
 * delivery modes — coalescing (k=1) and in-order stale (the Mathematician's k=2). Not the
 * model check — that stays the Mathematician's spike — but it runs the REAL units, asserts
 * the same per-step properties, and then drives every walk to quiescence and asserts
 * convergence (P2). Deterministic: a failure prints its seed and its trace.
 */
describe('random walks — per-step properties and convergence against the real units', () => {
  function rng(seed: number) {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  function walk(seed: number, start: Start, purge: boolean, delivery: Delivery, steps: number): string[] {
    const rand = rng(seed)
    const w = new SyncWorld(start, delivery)
    const trace: string[] = []
    for (let s = 0; s < steps; s++) {
      const options: string[] = []
      for (const d of [0, 1]) {
        const dev = w.dev(d)
        for (const [id, row] of dev.rows) {
          options.push(`edit(${d},${id})`, `del(${d},${id})`)
          if (row.pendingRev !== null && !dev.flights.has(id)) options.push(`bpush(${d},${id})`)
        }
        for (const id of dev.flights.keys()) options.push(`cpush(${d},${id})`, `lose(${d},${id})`)
        for (const id of w.deliverable(d)) options.push(`snap(${d},${id})`)
      }
      if (purge) for (const id of w.server.keys()) options.push(`purge(${id})`)
      if (options.length === 0) break // everything purged and nothing held locally
      const pick = options[Math.floor(rand() * options.length)]!
      trace.push(pick)
      try {
        w.run(pick)
      } catch (e) {
        throw new Error(`seed ${seed} ${start} purge=${purge} ${delivery}\n${trace.join(' -> ')}\n${String(e)}`, { cause: e })
      }
    }
    let ok: boolean
    try {
      ok = w.quiesce()
    } catch (e) {
      throw new Error(`seed ${seed} ${start} purge=${purge} ${delivery} (quiesce)\n${trace.join(' -> ')}\n${String(e)}`, { cause: e })
    }
    if (!ok) throw new Error(`seed ${seed} ${start} purge=${purge} ${delivery}: did not converge\n${trace.join(' -> ')}`)
    return trace
  }

  for (const delivery of ['current', 'queued'] as const) {
    for (const start of ['landed', 'create'] as const) {
      for (const purge of [false, true]) {
        it(`${delivery} delivery, ${start}, purge ${purge ? 'on' : 'off'}: 400 walks × 30 steps`, () => {
          for (let seed = 1; seed <= 400; seed++) walk(seed, start, purge, delivery, 30)
        })
      }
    }
  }
})
