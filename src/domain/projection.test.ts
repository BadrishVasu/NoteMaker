import { describe, expect, it } from 'vitest'
import { listView, outboxCount, searchMatches, trashView } from './projection'
import { makeRow } from '../test/rows'
import type { LocalNote } from './note'

const ids = (rows: readonly LocalNote[]): string[] => rows.map((r) => r.id)

describe('listView', () => {
  it('shows live Notes only — a Tombstoned row belongs to the Trash, not the list', () => {
    const live = makeRow({ id: 'live' })
    const trashed = makeRow({ id: 'trashed', deletedAt: 5_000 })
    expect(ids(listView([live, trashed], ''))).toEqual(['live'])
  })

  it('orders by updatedAt desc — the provisional order from 05, and the only one decided', () => {
    const old = makeRow({ id: 'old', updatedAt: 1_000 })
    const recent = makeRow({ id: 'recent', updatedAt: 3_000 })
    const middle = makeRow({ id: 'middle', updatedAt: 2_000 })
    expect(ids(listView([old, recent, middle], ''))).toEqual(['recent', 'middle', 'old'])
  })

  it('breaks an updatedAt tie on id, so the list cannot reorder itself between renders', () => {
    const b = makeRow({ id: 'b', updatedAt: 2_000 })
    const a = makeRow({ id: 'a', updatedAt: 2_000 })
    expect(ids(listView([b, a], ''))).toEqual(['a', 'b'])
    expect(ids(listView([a, b], ''))).toEqual(['a', 'b'])
  })

  it('returns the same row objects it was given — identity is what stops every row re-rendering', () => {
    const row = makeRow({ id: 'x' })
    expect(listView([row], '')[0]).toBe(row)
  })

  it('filters on the query', () => {
    const groceries = makeRow({ id: 'g', title: 'Groceries', body: 'milk' })
    const other = makeRow({ id: 'o', title: 'Standup', body: 'notes' })
    expect(ids(listView([groceries, other], 'milk'))).toEqual(['g'])
  })

  it('a whitespace-only query is not a filter', () => {
    const a = makeRow({ id: 'a' })
    const b = makeRow({ id: 'b' })
    expect(listView([a, b], '   ')).toHaveLength(2)
  })
})

describe('searchMatches', () => {
  // 05 decided placement only; matching, ranking and scope are ticket 06. What is fixed here is
  // the scope the empty state claims out loud: "search covers titles and note text".
  const row = makeRow({ id: 's', title: 'Groceries', body: 'Buy MILK and eggs' })

  it('matches the title', () => {
    expect(searchMatches(row, 'groc')).toBe(true)
  })

  it('matches the body', () => {
    expect(searchMatches(row, 'eggs')).toBe(true)
  })

  it('ignores case in both directions', () => {
    expect(searchMatches(row, 'milk')).toBe(true)
    expect(searchMatches(row, 'GROCERIES')).toBe(true)
  })

  it('ignores surrounding whitespace in the query', () => {
    expect(searchMatches(row, '  eggs  ')).toBe(true)
  })

  it('does not match what is absent', () => {
    expect(searchMatches(row, 'bread')).toBe(false)
  })
})

describe('trashView', () => {
  it('shows Tombstoned rows only', () => {
    const live = makeRow({ id: 'live' })
    const trashed = makeRow({ id: 'trashed', deletedAt: 5_000 })
    expect(ids(trashView([live, trashed]))).toEqual(['trashed'])
  })

  it('orders by deletedAt desc — the Trash row shows when it was deleted, not when it was edited', () => {
    const first = makeRow({ id: 'first', deletedAt: 1_000, updatedAt: 9_000 })
    const last = makeRow({ id: 'last', deletedAt: 3_000, updatedAt: 1 })
    expect(ids(trashView([first, last]))).toEqual(['last', 'first'])
  })

  it('breaks a deletedAt tie on id', () => {
    const b = makeRow({ id: 'b', deletedAt: 2_000 })
    const a = makeRow({ id: 'a', deletedAt: 2_000 })
    expect(ids(trashView([b, a]))).toEqual(['a', 'b'])
  })
})

describe('outboxCount', () => {
  it('counts rows with a pendingRev — 03: the Outbox is a column, not a second store', () => {
    const clean = makeRow({ id: 'clean' })
    const dirty = makeRow({ id: 'dirty', pendingRev: makeRow().rev })
    expect(outboxCount([clean, dirty])).toBe(1)
  })

  it('counts a Tombstoned row that has not been pushed — a delete is a write waiting to sync', () => {
    const deletedAndDirty = makeRow({ id: 'd', deletedAt: 5_000, pendingRev: makeRow().rev })
    expect(outboxCount([deletedAndDirty])).toBe(1)
  })

  it('is zero on an empty corpus', () => {
    expect(outboxCount([])).toBe(0)
  })
})
