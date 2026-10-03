import { asNoteId, asRev } from '../domain/note'
import type { NoteDoc } from '../domain/note'
import { mapSnapshot } from './firestoreGateway'

// Ticket 03, amendment 2026-10-03: the delivery rule the persistent SDK cache forces. The emulator
// test (persistentCache.emulator.test.ts) proves the stale-cache case end to end; this pins the
// rule itself, including the case the emulator cannot produce on demand — a from-cache delivery
// AFTER the server view has landed, which carries a real update and must NOT be dropped.

const N = asNoteId('N')
const M = asNoteId('M')
const doc = (rev: string, body: string): NoteDoc => ({
  title: 'T',
  titleIsCustom: true,
  body,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  rev: asRev(rev),
})

const snapshot = (fromCache: boolean, docs: { id: typeof N; doc: NoteDoc | null }[], changes = docs) => ({
  fromCache,
  docs,
  changes,
})

describe('mapSnapshot', () => {
  it('drops the content of a from-cache delivery before the server view has landed', () => {
    const stale = snapshot(true, [{ id: N, doc: doc('r1', 'the SDK cache’s stale copy') }])
    expect(mapSnapshot(stale, false)).toEqual({ fromCache: true, complete: false, changes: [] })
  })

  it('the first server-backed delivery is the complete batch, carrying the WHOLE collection', () => {
    const full = snapshot(
      false,
      [
        { id: N, doc: doc('r2', 'two') },
        { id: M, doc: doc('r3', 'three') },
      ],
      [{ id: M, doc: doc('r3', 'three') }], // docChanges is relative to a cached snapshot: narrower
    )
    expect(mapSnapshot(full, false)).toEqual({
      fromCache: false,
      complete: true,
      changes: [
        { id: N, doc: doc('r2', 'two') },
        { id: M, doc: doc('r3', 'three') },
      ],
    })
  })

  it('applies a from-cache delivery AFTER the complete batch — the rule must not widen to it', () => {
    const catchUp = snapshot(true, [], [{ id: N, doc: doc('r9', 'a real local or catch-up update') }])
    expect(mapSnapshot(catchUp, true)).toEqual({
      fromCache: true,
      complete: false,
      changes: [{ id: N, doc: doc('r9', 'a real local or catch-up update') }],
    })
  })

  it('after the complete batch, carries changes only — including removals — and is never complete again', () => {
    const removal = snapshot(false, [], [{ id: N, doc: null }])
    expect(mapSnapshot(removal, true)).toEqual({ fromCache: false, complete: false, changes: [{ id: N, doc: null }] })
  })
})
