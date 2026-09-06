import { describe, it, expect } from 'vitest'
import { resolveTitle, isDefaultTitle, nextUntitledN } from './title'

/**
 * Ticket 01, "Title resolution", is the specification under test. Its three branches:
 *   1. Custom titled and non-empty        → whatever the user typed
 *   2. Derived, body has a non-empty line → first non-empty line, heading markers
 *                                           stripped, trimmed, truncated to 100
 *   3. Otherwise                          → the Default title, `Untitled Note N`
 * Plus the one-way `titleIsCustom` latch, and `N` allocated as one greater than the
 * highest `Untitled Note N` in the local mirror.
 *
 * Pure: no clock, no I/O. `N` is passed in; the caller scans the mirror.
 */

const derived = (body: string, title = '') => ({ title, titleIsCustom: false, body })
const custom = (title: string, body = '') => ({ title, titleIsCustom: true, body })

describe('resolveTitle — branch 1, Custom titled and non-empty', () => {
  it('returns what the user typed', () => {
    expect(resolveTitle(custom('Groceries'), 7)).toBe('Groceries')
  })

  it('beats a derivable body line — Custom wins over Derived', () => {
    expect(resolveTitle(custom('Groceries', '# Shopping list'), 7)).toBe('Groceries')
  })

  it('trims surrounding whitespace', () => {
    expect(resolveTitle(custom('  Groceries  '), 7)).toBe('Groceries')
  })

  it('does NOT truncate a Custom title — only Derived titles are capped', () => {
    const long = 'x'.repeat(140)
    expect(resolveTitle(custom(long), 7)).toBe(long)
  })

  it('falls through to the Default title when the user has emptied it (branch 3)', () => {
    expect(resolveTitle(custom(''), 7)).toBe('Untitled Note 7')
  })

  it('treats a whitespace-only Custom title as empty — the rules require non-empty', () => {
    expect(resolveTitle(custom('   \n\t '), 7)).toBe('Untitled Note 7')
  })

  it('does not derive from the body once Custom and emptied — the latch is one-way', () => {
    expect(resolveTitle(custom('', '# Shopping list'), 7)).toBe('Untitled Note 7')
  })
})

describe('resolveTitle — branch 2, Derived from the body', () => {
  it('takes the first non-empty line', () => {
    expect(resolveTitle(derived('Groceries\nmilk\neggs'), 7)).toBe('Groceries')
  })

  it('skips leading blank and whitespace-only lines', () => {
    expect(resolveTitle(derived('\n   \n\t\nGroceries\nmilk'), 7)).toBe('Groceries')
  })

  it('strips leading markdown heading markers', () => {
    expect(resolveTitle(derived('# Groceries'), 7)).toBe('Groceries')
    expect(resolveTitle(derived('### Groceries'), 7)).toBe('Groceries')
    expect(resolveTitle(derived('###### Groceries'), 7)).toBe('Groceries')
  })

  it('strips heading markers written without a space', () => {
    expect(resolveTitle(derived('#Groceries'), 7)).toBe('Groceries')
  })

  it('strips markers on an indented heading line', () => {
    expect(resolveTitle(derived('   ## Groceries'), 7)).toBe('Groceries')
  })

  it('leaves a mid-line hash alone', () => {
    expect(resolveTitle(derived('Aisle #4'), 7)).toBe('Aisle #4')
  })

  it('trims trailing whitespace', () => {
    expect(resolveTitle(derived('Groceries   \nmilk'), 7)).toBe('Groceries')
  })

  it('truncates to 100 characters', () => {
    const line = 'y'.repeat(130)
    expect(resolveTitle(derived(line), 7)).toBe('y'.repeat(100))
  })

  it('truncates AFTER stripping the marker, not before', () => {
    const line = '# ' + 'y'.repeat(130)
    expect(resolveTitle(derived(line), 7)).toBe('y'.repeat(100))
  })

  it('skips a line that is only heading markers — stripping it would give an empty title', () => {
    expect(resolveTitle(derived('###\n\nGroceries'), 7)).toBe('Groceries')
  })

  it('handles CRLF line endings', () => {
    expect(resolveTitle(derived('\r\nGroceries\r\nmilk'), 7)).toBe('Groceries')
  })

  it('re-derives as the body changes — the Default title does not latch', () => {
    expect(resolveTitle(derived('# Groceries', 'Untitled Note 3'), 7)).toBe('Groceries')
  })

  it('ignores the stored title entirely while Derived with a derivable line', () => {
    expect(resolveTitle(derived('Shopping', 'Stale'), 7)).toBe('Shopping')
  })
})

describe('resolveTitle — branch 3, the Default title', () => {
  it('uses the allocated N for an empty body while Derived', () => {
    expect(resolveTitle(derived(''), 3)).toBe('Untitled Note 3')
  })

  it('uses the allocated N for a whitespace-only body', () => {
    expect(resolveTitle(derived('  \n\t\n '), 3)).toBe('Untitled Note 3')
  })

  it('keeps an already-allocated Default title rather than renumbering it', () => {
    // Ticket 01: "existing Notes are never renumbered". The row is still Derived, so
    // its stored title can only be a previous resolution — reallocating would renumber.
    expect(resolveTitle(derived('', 'Untitled Note 3'), 9)).toBe('Untitled Note 3')
  })

  it('replaces a stale Derived title with a freshly allocated Default title', () => {
    expect(resolveTitle(derived('', 'Groceries'), 9)).toBe('Untitled Note 9')
  })

  it('does not keep a Custom title that merely looks like a Default title', () => {
    // 05: a Note the user deliberately named `Untitled Note 4` is Custom. Emptying it
    // drops to a freshly allocated Default title, not back to what they typed.
    expect(resolveTitle(custom('', 'anything'), 9)).toBe('Untitled Note 9')
  })

  it('never returns an empty title, in any branch', () => {
    for (const state of [derived(''), derived('   '), custom(''), custom('  ')]) {
      expect(resolveTitle(state, 1).length).toBeGreaterThan(0)
    }
  })
})

describe('isDefaultTitle', () => {
  // 05: computed from `!titleIsCustom && no derivable first line` — never by
  // regex-matching the stored string.
  it('is true for a Derived Note with no derivable line', () => {
    expect(isDefaultTitle(derived('', 'Untitled Note 3'))).toBe(true)
    expect(isDefaultTitle(derived('  \n ', 'Untitled Note 3'))).toBe(true)
    expect(isDefaultTitle(derived('##', 'Untitled Note 3'))).toBe(true)
  })

  it('is false as soon as the body has a derivable line', () => {
    expect(isDefaultTitle(derived('# Groceries', 'Groceries'))).toBe(false)
  })

  it('is false for a Custom Note whose title happens to read `Untitled Note 4`', () => {
    expect(isDefaultTitle(custom('Untitled Note 4'))).toBe(false)
  })

  it('is false for a Custom Note the user has emptied, even though it displays a Default title', () => {
    // The displayed title is `Untitled Note N`, but the Note is Custom: the latch has
    // flipped and clearing the field does not return it to Derived.
    expect(isDefaultTitle(custom(''))).toBe(false)
  })
})

describe('nextUntitledN', () => {
  it('starts at 1 in an empty mirror', () => {
    expect(nextUntitledN([])).toBe(1)
  })

  it('starts at 1 when nothing is an Untitled Note', () => {
    expect(nextUntitledN(['Groceries', 'Ideas'])).toBe(1)
  })

  it('is one greater than the highest, not one greater than the count', () => {
    expect(nextUntitledN(['Untitled Note 1', 'Untitled Note 7'])).toBe(8)
  })

  it('compares numerically, not as strings', () => {
    expect(nextUntitledN(['Untitled Note 9', 'Untitled Note 10'])).toBe(11)
  })

  it('never reuses a number after a delete — the gap stays a gap', () => {
    expect(nextUntitledN(['Untitled Note 5'])).toBe(6)
  })

  it('ignores titles that only start with the prefix', () => {
    expect(nextUntitledN(['Untitled Note 4 (old)', 'Untitled Notes 9', 'Untitled Note'])).toBe(1)
  })

  it('ignores a non-numeric suffix', () => {
    expect(nextUntitledN(['Untitled Note x', 'Untitled Note 2x'])).toBe(1)
  })

  it('ignores a negative or signed suffix', () => {
    expect(nextUntitledN(['Untitled Note -3', 'Untitled Note +3'])).toBe(1)
  })

  it('ignores surrounding whitespace differences — the stored title is exact', () => {
    expect(nextUntitledN([' Untitled Note 4', 'Untitled Note 4 '])).toBe(1)
  })

  it('accepts a padded number for what it is', () => {
    expect(nextUntitledN(['Untitled Note 007'])).toBe(8)
  })

  it('scans Custom titles too — the number space is the mirror, not the Derived subset', () => {
    // A Note the user deliberately named `Untitled Note 4` still occupies 4; handing a
    // new Note the same title would produce a confusing duplicate for no benefit.
    expect(nextUntitledN(['Untitled Note 4'])).toBe(5)
  })
})
