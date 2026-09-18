import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createCorpus } from '../sync/corpus'
import { useCorpus } from './useCorpus'
import { useNote } from './useNote'
import { useOutboxCount } from './useOutboxCount'
import { makeRow, resetRows } from '../test/rows'
import { asRev } from '../domain/note'

describe('useCorpus', () => {
  it('returns the current rows and updates when the corpus changes', () => {
    resetRows()
    const corpus = createCorpus()
    const row = makeRow({ id: 'n1' })
    corpus.replaceAll([row])
    const { result } = renderHook(() => useCorpus(corpus))
    expect(result.current.get(row.id)).toBe(row)

    const updated = { ...row, body: 'changed' }
    act(() => corpus.applyWrites([{ op: 'put', row: updated }]))
    expect(result.current.get(row.id)).toBe(updated)
  })
})

describe('useNote', () => {
  it('returns undefined for a null id, and the row once it exists', () => {
    resetRows()
    const corpus = createCorpus()
    const row = makeRow({ id: 'n2' })
    const { result, rerender } = renderHook(({ id }) => useNote(corpus, id), {
      initialProps: { id: null as ReturnType<typeof makeRow>['id'] | null },
    })
    expect(result.current).toBeUndefined()

    act(() => corpus.replaceAll([row]))
    rerender({ id: row.id })
    expect(result.current).toBe(row)
  })

  it('stays referentially stable when an unrelated row changes', () => {
    resetRows()
    const corpus = createCorpus()
    const a = makeRow({ id: 'a' })
    const b = makeRow({ id: 'b' })
    corpus.replaceAll([a, b])
    const { result } = renderHook(() => useNote(corpus, a.id))
    const first = result.current
    act(() => corpus.applyWrites([{ op: 'put', row: { ...b, body: 'x' } }]))
    expect(result.current).toBe(first)
  })
})

describe('useOutboxCount', () => {
  it('counts rows with a non-null pendingRev, including trashed ones', () => {
    resetRows()
    const corpus = createCorpus()
    const clean = makeRow({ id: 'c1' })
    const dirty = makeRow({ id: 'c2', pendingRev: asRev('p2') })
    const trashed = makeRow({ id: 'c3', pendingRev: asRev('p3'), deletedAt: 123 })
    corpus.replaceAll([clean, dirty, trashed])
    const { result } = renderHook(() => useOutboxCount(corpus))
    expect(result.current).toBe(2)
  })
})
