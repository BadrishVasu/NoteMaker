import { describe, it, expect } from 'vitest'
import { asNoteId, asRev } from './note'
import type { LocalNote } from './note'
import { newLocalNote, recordEdit } from './edit'

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
