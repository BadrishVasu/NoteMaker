import { describe, expect, it } from 'vitest'
import { SYNC_SIZE_LIMIT_BYTES, exceedsSyncLimit, syncSizeBytes } from './size'
import { makeRow } from '../test/rows'

describe('syncSizeBytes', () => {
  it('measures title and body together — one Note, one number', () => {
    expect(syncSizeBytes({ title: 'abc', body: 'de' })).toBe(5)
  })

  it('measures UTF-8 bytes, not code units — a 1-char emoji is not 1 byte', () => {
    expect(syncSizeBytes({ title: '', body: '😀' })).toBe(4)
  })
})

describe('exceedsSyncLimit', () => {
  // 05, corrected 2026-08-26: ~450 KiB, not ~1 MiB. A Conflict copy carries its own content AND
  // `conflictBase` (the fork point) in ONE document, so a Note needs roughly twice its own size
  // to land on the day it conflicts. The visible threshold must be the conflict-safe one.
  it('is half of Firestore’s 1 MiB document cap, less headroom for the other fields', () => {
    expect(SYNC_SIZE_LIMIT_BYTES).toBe(450 * 1024)
  })

  it('does not fire on a Note exactly at the limit', () => {
    expect(exceedsSyncLimit(makeRow({ title: '', body: 'x'.repeat(SYNC_SIZE_LIMIT_BYTES) }))).toBe(false)
  })

  it('fires one byte past it', () => {
    expect(exceedsSyncLimit(makeRow({ title: '', body: 'x'.repeat(SYNC_SIZE_LIMIT_BYTES + 1) }))).toBe(true)
  })

  it('counts the title against the same budget', () => {
    const body = 'x'.repeat(SYNC_SIZE_LIMIT_BYTES - 2)
    expect(exceedsSyncLimit(makeRow({ title: 'abc', body }))).toBe(true)
  })

  it('is false on an ordinary Note', () => {
    expect(exceedsSyncLimit(makeRow({ title: 'Groceries', body: 'milk' }))).toBe(false)
  })
})
