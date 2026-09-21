import { describe, it, expect } from 'vitest'
import { asNoteId, asRev } from './note'
import type { LocalNote } from './note'
import { bufferEdit, newLocalNote, recordEdit, sameVisible } from './edit'

/**
 * Entering the Outbox. 02: `pendingRev` is minted at edit time on every keystroke, in both
 * Auto sync and manual modes. 02 appendix 3, capture point 1: clean → dirty sets
 * `baseContent := the row's content before the edit`; a row already dirty keeps its
 * `baseContent`, because its `baseRev` has not moved. The rev and the timestamp are passed
 * in — `domain/` mints nothing and reads no clock.
 */

const ID = asNoteId('noteA')

const clean: LocalNote = {
  id: ID,
  title: 'Groceries',
  titleIsCustom: true,
  body: 'base',
  createdAt: 1_000,
  updatedAt: 2_000,
  deletedAt: null,
  rev: asRev('R1'),
  baseRev: asRev('R1'),
  pendingRev: null,
  baseContent: null,
}

describe('recordEdit', () => {
  it('clean → dirty captures the content before the edit as baseContent (capture point 1)', () => {
    const next = recordEdit(clean, { ...clean, body: 'typed' }, asRev('R2'), 3_000)
    expect(next).toEqual({
      ...clean,
      body: 'typed',
      updatedAt: 3_000,
      rev: asRev('R2'),
      pendingRev: asRev('R2'),
      baseContent: { title: 'Groceries', titleIsCustom: true, body: 'base' },
    })
  })

  it('dirty → dirty keeps baseContent and baseRev; only content, rev and pendingRev move', () => {
    const once = recordEdit(clean, { ...clean, body: 'typed' }, asRev('R2'), 3_000)
    const twice = recordEdit(once, { ...once, body: 'typed more' }, asRev('R3'), 4_000)
    expect(twice.baseRev).toBe(asRev('R1'))
    expect(twice.baseContent).toEqual({ title: 'Groceries', titleIsCustom: true, body: 'base' })
    expect(twice.pendingRev).toBe(asRev('R3'))
    expect(twice.rev).toBe(asRev('R3'))
  })

  it('a delete is an edit: sets deletedAt, mints a rev, captures like any edit', () => {
    const next = recordEdit(clean, { ...clean, deletedAt: 3_000 }, asRev('R2'), 3_000)
    expect(next.deletedAt).toBe(3_000)
    expect(next.pendingRev).toBe(asRev('R2'))
    expect(next.baseContent).toEqual({ title: 'Groceries', titleIsCustom: true, body: 'base' })
  })

  it('an edit on an unlanded create keeps baseContent null (no base to capture)', () => {
    const create = newLocalNote(ID, { title: 'Untitled Note 1', titleIsCustom: false, body: '' }, asRev('C1'), 1_000)
    const next = recordEdit(create, { ...create, body: 'x' }, asRev('C2'), 2_000)
    expect(next.baseRev).toBeNull()
    expect(next.baseContent).toBeNull()
  })

  it('refuses a clean row with no baseRev — P-CLEAN says it cannot exist', () => {
    expect(() => recordEdit({ ...clean, baseRev: null }, clean, asRev('R2'), 3_000)).toThrow()
  })

  it('never carries a local field into content from the `next` argument', () => {
    const next = recordEdit(clean, { title: 'T', titleIsCustom: true, body: 'b', deletedAt: null }, asRev('R2'), 3_000)
    expect(next.id).toBe(ID)
    expect(next.createdAt).toBe(1_000)
  })
})

describe('newLocalNote', () => {
  it('is a dirty unlanded create: baseRev null, pendingRev = rev, baseContent null, live', () => {
    expect(newLocalNote(ID, { title: 'Untitled Note 1', titleIsCustom: false, body: '' }, asRev('C1'), 1_000)).toEqual({
      id: ID,
      title: 'Untitled Note 1',
      titleIsCustom: false,
      body: '',
      createdAt: 1_000,
      updatedAt: 1_000,
      deletedAt: null,
      rev: asRev('C1'),
      baseRev: null,
      pendingRev: asRev('C1'),
      baseContent: null,
    })
  })
})

// 02, amendment 2026-09-21, rule 3 (mathematician): the editor buffer is a dirty row. An edit
// commit applies onto the stored row only if that row still shows what the buffer was derived
// from (`base`); otherwise the edit is concurrent and is recorded against `base`, so its push
// conflicts instead of overwriting whatever the row now holds.
describe('sameVisible — the fast-forward predicate', () => {
  it('compares content and the null-ness of deletedAt, not revs or timestamps', () => {
    expect(sameVisible(clean, { ...clean, rev: asRev('R9'), updatedAt: 9 } as LocalNote)).toBe(true)
    expect(sameVisible(clean, { ...clean, deletedAt: 5 })).toBe(false)
    expect(sameVisible({ ...clean, deletedAt: 4 }, { ...clean, deletedAt: 5 })).toBe(true)
    expect(sameVisible(clean, { ...clean, body: 'x' })).toBe(false)
    expect(sameVisible(clean, { ...clean, title: 'x' })).toBe(false)
    expect(sameVisible(clean, { ...clean, titleIsCustom: false })).toBe(false)
  })
})

describe('bufferEdit', () => {
  const typed = { title: 'Groceries', titleIsCustom: true, body: 'base + typed', deletedAt: null }
  const theirs: LocalNote = { ...clean, body: 'their edit', rev: asRev('S'), baseRev: asRev('S'), updatedAt: 5_000 }

  it('stored row still shows the base → an ordinary edit onto the STORED row (its bookkeeping kept)', () => {
    // e.g. our own push made it clean at a rev we wrote: the engine's baseRev must survive.
    const stored = { ...clean, rev: asRev('P1'), baseRev: asRev('P1') }
    const base = { ...clean, rev: asRev('P1'), baseRev: asRev('R1'), pendingRev: asRev('P1'), baseContent: { title: 'Groceries', titleIsCustom: true, body: 'older' } }
    expect(bufferEdit(ID, stored, base, typed, asRev('P2'), 6_000)).toEqual(recordEdit(stored, typed, asRev('P2'), 6_000))
  })

  it('a fast-forward adopt (same content, new rev) is still ordinary — no spurious copy', () => {
    const stored = { ...clean, rev: asRev('FF'), baseRev: asRev('FF') }
    expect(bufferEdit(ID, stored, clean, typed, asRev('P2'), 6_000).baseRev).toBe(asRev('FF'))
  })

  it('stored row adopted underneath (other content) → concurrent: baseRev := base.rev, baseContent := base content', () => {
    const next = bufferEdit(ID, theirs, clean, typed, asRev('P2'), 6_000)
    expect(next).toMatchObject({
      id: ID,
      body: 'base + typed',
      rev: asRev('P2'),
      pendingRev: asRev('P2'),
      baseRev: asRev('R1'),
      baseContent: { title: 'Groceries', titleIsCustom: true, body: 'base' },
    })
  })

  it('concurrent against a base the queue itself wrote (dirty): baseRev := that rev and its content', () => {
    const ownCommit: LocalNote = { ...clean, body: 'T1', rev: asRev('T1'), pendingRev: asRev('T1'), baseContent: { title: 'Groceries', titleIsCustom: true, body: 'base' } }
    const next = bufferEdit(ID, theirs, ownCommit, { ...typed, body: 'T1 more' }, asRev('P2'), 6_000)
    expect(next).toMatchObject({ baseRev: asRev('T1'), pendingRev: asRev('P2'), baseContent: { body: 'T1' } })
  })

  it('a remote trash underneath is concurrent too: the tombstone is not silently undone', () => {
    const trashed = { ...clean, deletedAt: 7, rev: asRev('S'), baseRev: asRev('S') }
    expect(bufferEdit(ID, trashed, clean, typed, asRev('P2'), 6_000).baseRev).toBe(asRev('R1'))
  })

  it('stored row absent → recreated dirty against the base, never dropped', () => {
    expect(bufferEdit(ID, undefined, clean, typed, asRev('P2'), 6_000)).toMatchObject({
      id: ID,
      body: 'base + typed',
      baseRev: asRev('R1'),
      pendingRev: asRev('P2'),
    })
  })
})
