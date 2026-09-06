// src/domain/title.ts
// Ticket 01, "Title resolution". Pure: no clock, no I/O, no store access.
// `N` is passed in by the caller, which scans the local mirror with `nextUntitledN`.

/** The three fields title resolution reads. A `LocalNote` satisfies this structurally. */
export interface TitleState {
  title: string
  titleIsCustom: boolean
  body: string
}

/** Max length of a Derived title (ticket 01). Custom titles are not truncated. */
const DERIVED_MAX = 100

/** Leading markdown ATX heading markers, optionally indented. Only at line start. */
const HEADING = /^\s*#{1,6}\s*/

/** An exactly-shaped Default title. Never used to answer "is this Note Default titled" —
 *  that is `isDefaultTitle`, per ticket 05. Used only to allocate the next number and to
 *  recognise a number this Note already holds, so that it is not renumbered. */
const DEFAULT_TITLE = /^Untitled Note (\d+)$/

const defaultTitle = (n: number): string => `Untitled Note ${n}`

/**
 * The first line of the body that yields a non-empty title, with heading markers
 * stripped, trimmed and truncated. `null` when the body has none — which is branch 3.
 *
 * A line of bare markers (`###`) is skipped rather than accepted and then trimmed to
 * nothing: `title` is non-empty by security rule, so no branch may produce `''`.
 */
function deriveFromBody(body: string): string | null {
  for (const line of body.split('\n')) {
    const derived = line.replace(HEADING, '').trim()
    if (derived !== '') return derived.slice(0, DERIVED_MAX)
  }
  return null
}

/**
 * Ticket 05: Default-titled is `!titleIsCustom && no derivable first line`, computed
 * from state and never by regex-matching the stored string — a Note the user
 * deliberately named `Untitled Note 4` is Custom, not Default.
 */
export const isDefaultTitle = (n: TitleState): boolean =>
  !n.titleIsCustom && deriveFromBody(n.body) === null

/**
 * Ticket 01's resolution order, evaluated whenever the Note is saved.
 *
 * `untitledN` is the number to allocate *if* branch 3 has to allocate one. The caller
 * computes it with `nextUntitledN` over the mirror; passing it unconditionally keeps
 * this function pure and costs one scan the caller is already able to make.
 */
export function resolveTitle(n: TitleState, untitledN: number): string {
  // 1. Custom titled and non-empty → whatever the user typed.
  //    Emptiness is tested on the trimmed value, because a whitespace-only title would
  //    pass the security rule's non-empty check and display as a blank Note.
  if (n.titleIsCustom) {
    const typed = n.title.trim()
    if (typed !== '') return typed
    // A Custom title the user has emptied falls to branch 3 — never back to the body.
    return defaultTitle(untitledN)
  }

  // 2. Derived titled, body has a non-empty line.
  const derived = deriveFromBody(n.body)
  if (derived !== null) return derived

  // 3. Otherwise → the Default title. If this row already holds one, keep it:
  //    ticket 01 says existing Notes are never renumbered, and while Derived the stored
  //    title can only be a previous resolution of this same function.
  return DEFAULT_TITLE.test(n.title) ? n.title : defaultTitle(untitledN)
}

/**
 * Ticket 01: `N` is one greater than the highest `Untitled Note N` currently in the
 * local mirror, so numbers are never reused after a delete and nothing is renumbered.
 * Two offline devices may independently produce the same `N`; accepted as harmless.
 */
export function nextUntitledN(mirrorTitles: readonly string[]): number {
  let highest = 0
  for (const title of mirrorTitles) {
    const m = DEFAULT_TITLE.exec(title)
    if (m === null) continue
    const n = Number(m[1])
    if (n > highest) highest = n
  }
  return highest + 1
}
