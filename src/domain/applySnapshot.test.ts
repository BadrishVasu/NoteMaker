import { describe, it, expect } from 'vitest'
import { asNoteId, asRev } from './note'
import type { LocalNote, NoteDoc } from './note'
import { applySnapshot, SyncInvariantError } from './applySnapshot'

/**
 * 02, appendix "`applySnapshot(localRow, serverDoc)` — the complete table". One test per
 * cell, numbered as the table numbers them. Cells 11–14 ("dirty, push in flight") are
 * identical to 7–10 by construction: `applySnapshot` takes no in-flight argument, so it
 * cannot distinguish them — that absence IS the test, and the signature enforces it.
 *
 * The `lastServerState` side effect (every cell: present ⇒ record, absent ⇒ delete) is the
 * engine's, applied from the same `serverDoc` it passes in here. Not duplicated as a return.
 */

const ID = asNoteId('noteA')

const doc = (rev: string, body: string, over: Partial<NoteDoc> = {}): NoteDoc => ({
  title: 'Groceries',
  titleIsCustom: true,
  body,
  createdAt: 1_000,
  updatedAt: 2_000,
  deletedAt: null,
  rev: asRev(rev),
  ...over,
})

const clean = (rev: string, body: string): LocalNote => ({
  ...doc(rev, body),
  id: ID,
  baseRev: asRev(rev),
  pendingRev: null,
  baseContent: null,
})

/** Dirty at `base` (content `baseBody`), current content `body` under `pending`. */
const dirty = (base: string, baseBody: string, pending: string, body: string): LocalNote => ({
  ...doc(pending, body, { updatedAt: 3_000 }),
  id: ID,
  baseRev: asRev(base),
  pendingRev: asRev(pending),
  baseContent: { title: 'Groceries', titleIsCustom: true, body: baseBody },
})

describe('applySnapshot — local row absent', () => {
  it('cell 1: absent × absent → no-op', () => {
    expect(applySnapshot(undefined, ID, null)).toEqual([])
  })

  it('cell 2: absent × present → insert a clean row, baseRev := rev', () => {
    expect(applySnapshot(undefined, ID, doc('R1', 'hello'))).toEqual([
      { op: 'put', row: clean('R1', 'hello') },
    ])
  })

  it('cell 2: carries conflictOf / conflictBase when the delivered doc is a copy', () => {
    const copy = doc('R1', 'mine', {
      conflictOf: asNoteId('root'),
      conflictBase: { title: 'Groceries', titleIsCustom: true, body: 'base' },
    })
    const [w] = applySnapshot(undefined, ID, copy)
    expect(w).toEqual({ op: 'put', row: { ...copy, id: ID, baseRev: asRev('R1'), pendingRev: null, baseContent: null } })
  })
})

describe('applySnapshot — clean local row', () => {
  it('cell 3: clean × absent → delete the local row', () => {
    expect(applySnapshot(clean('R1', 'x'), ID, null)).toEqual([{ op: 'delete', id: ID }])
  })

  it('cell 4: clean × rev === baseRev → no-op', () => {
    expect(applySnapshot(clean('R1', 'x'), ID, doc('R1', 'x'))).toEqual([])
  })

  it('cell 4: asserts the content is already identical — a rev names exactly one content', () => {
    expect(() => applySnapshot(clean('R1', 'x'), ID, doc('R1', 'DIFFERENT'))).toThrow(SyncInvariantError)
    expect(() => applySnapshot(clean('R1', 'x'), ID, doc('R1', 'x', { deletedAt: 9 }))).toThrow(SyncInvariantError)
  })

  it('cell 5 is unrepresentable: a clean row has pendingRev === null and a doc rev is never null', () => {
    // Nothing to call. Recorded so the table has no silent gap.
    expect(clean('R1', 'x').pendingRev).toBeNull()
  })

  it('cell 6: clean × neither → adopt content, baseRev := rev', () => {
    expect(applySnapshot(clean('R1', 'x'), ID, doc('R2', 'theirs', { updatedAt: 7_000 }))).toEqual([
      { op: 'put', row: { ...clean('R2', 'theirs'), updatedAt: 7_000 } },
    ])
  })

  it('cell 6: adopts a tombstone, and does not keep a local-only field from the old row', () => {
    const [w] = applySnapshot(clean('R1', 'x'), ID, doc('R2', 'x', { deletedAt: 8_000 }))
    expect(w).toEqual({ op: 'put', row: { ...clean('R2', 'x'), deletedAt: 8_000 } })
  })
})

describe('applySnapshot — dirty local row (and 11–14, dirty with a push in flight)', () => {
  const row = dirty('R1', 'base', 'R2', 'mine')

  it('cell 7: dirty × absent → no-op; the row keeps its dirt AND its baseContent', () => {
    // Badrish, carried correction: this looks like a leak and it is not. The fork point is a
    // fact about a rev, not about the live document, and 02 appendix 3 reaches the trace
    // where this retained value is later written as a correct conflictBase.
    expect(applySnapshot(row, ID, null)).toEqual([])
  })

  it('cell 8: dirty × rev === baseRev → no-op', () => {
    expect(applySnapshot(row, ID, doc('R1', 'base'))).toEqual([])
  })

  it('cell 9: dirty × rev === pendingRev → clear dirty, baseRev := rev, content untouched', () => {
    expect(applySnapshot(row, ID, doc('R2', 'mine', { updatedAt: 3_000 }))).toEqual([
      { op: 'put', row: { ...row, baseRev: asRev('R2'), pendingRev: null, baseContent: null } },
    ])
  })

  it('cell 9: asserts our own write came back with our content', () => {
    expect(() => applySnapshot(row, ID, doc('R2', 'NOT MINE'))).toThrow(SyncInvariantError)
  })

  it('cell 10: dirty × neither → no-op; never touch content, never advance baseRev (02 trap)', () => {
    expect(applySnapshot(row, ID, doc('R9', 'theirs'))).toEqual([])
  })

  it('cell 10 on an unlanded create (baseRev null) is still a no-op', () => {
    const create: LocalNote = { ...row, baseRev: null, baseContent: null }
    expect(applySnapshot(create, ID, doc('R9', 'theirs'))).toEqual([])
  })

  it('is pure: returns fresh rows and never mutates its inputs', () => {
    const local = Object.freeze({ ...row })
    const server = Object.freeze(doc('R2', 'mine', { updatedAt: 3_000 }))
    const [w] = applySnapshot(local, ID, server)
    expect(w).toMatchObject({ op: 'put' })
    expect(local.pendingRev).toBe(asRev('R2'))
  })
})
