// src/domain/projection.ts
// Pure. Ticket 03: the whole corpus is in memory, so every view is an array filter — there are no
// queries and no indexes anywhere in this app.
//
// Every function here returns the SAME row objects it was given. `sync/corpus.ts` keeps row
// identity stable across changes so React can skip untouched rows; copying a row here would throw
// that away one layer above where it was earned.

import type { LocalNote } from './note'

/**
 * Ticket 06 owns matching, ranking and scope; ticket 05 decided only that the field exists and
 * where it sits. What is fixed before 06 lands is the scope the no-results empty state states out
 * loud — "search covers titles and note text" — so this is a case-insensitive substring over
 * exactly those two fields, and nothing more. 06 replaces the body of this function; its callers
 * and its signature are the part 05 settled.
 */
export function searchMatches(row: LocalNote, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return row.title.toLowerCase().includes(q) || row.body.toLowerCase().includes(q)
}

/**
 * The list screen: live Notes, newest edit first, filtered by the search field.
 *
 * The `id` tiebreak is not cosmetic. `updatedAt` is millisecond-resolution and a seeded corpus,
 * an import, or two edits inside one millisecond produce ties; without a total order the list can
 * reorder itself between two renders of identical data, which is 05's "the list must not re-sort
 * the open Note out from under the user" arriving by accident.
 */
export function listView(rows: Iterable<LocalNote>, query: string): LocalNote[] {
  const out: LocalNote[] = []
  for (const row of rows) {
    if (row.deletedAt !== null) continue
    if (!searchMatches(row, query)) continue
    out.push(row)
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * The Trash screen: Tombstoned rows, most recently deleted first. It sorts on `deletedAt`, not
 * `updatedAt`, because that is the timestamp the row shows ("deleted 2d ago") and a list that
 * sorts on one field while displaying another reads as broken.
 */
export function trashView(rows: Iterable<LocalNote>): LocalNote[] {
  const out: LocalNote[] = []
  for (const row of rows) if (row.deletedAt !== null) out.push(row)
  return out.sort(
    (a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

/**
 * Ticket 03: the Outbox is a column, not a second store. Tombstoned rows count — an unpushed
 * delete is a write waiting to sync exactly like an unpushed edit, and the strip that reads this
 * promises the user their *changes* are safe on this device.
 */
export function outboxCount(rows: Iterable<LocalNote>): number {
  let n = 0
  for (const row of rows) if (row.pendingRev !== null) n += 1
  return n
}
