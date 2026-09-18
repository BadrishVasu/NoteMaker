import { describe, expect, it } from 'vitest'
import { relativeTime } from './relativeTime'

describe('relativeTime', () => {
  const now = 1_000_000_000

  it('renders under a minute as "just now"', () => {
    expect(relativeTime(now - 5_000, now)).toBe('just now')
  })

  it('renders minutes', () => {
    expect(relativeTime(now - 4 * 60_000, now)).toBe('4m ago')
  })

  it('renders hours once past 60 minutes', () => {
    expect(relativeTime(now - 3 * 60 * 60_000, now)).toBe('3h ago')
  })

  it('renders days once past 24 hours', () => {
    expect(relativeTime(now - 2 * 24 * 60 * 60_000, now)).toBe('2d ago')
  })

  it('clamps a future timestamp to "just now" instead of a negative duration', () => {
    expect(relativeTime(now + 10_000, now)).toBe('just now')
  })
})
