// src/test/rows.ts
// A row factory for the step-6 tests (projection, corpus, and the React layer).
// Deliberately NOT shared with the step-3/4 reconcile tests, whose factory is shaped around
// one Note's flight and would grow two purposes if it were reused here.

import { asNoteId, asRev } from '../domain/note'
import type { LocalNote, NoteId } from '../domain/note'

let seq = 0

/**
 * A clean, live row. Every field the caller does not name gets a value that is legal under
 * `assertRowInvariant`: clean means `pendingRev === null` and therefore `baseContent === null`.
 *
 * Pass `pendingRev` to make it dirty and the factory supplies the `baseContent` the row
 * invariant then requires, so a test never has to remember that pairing.
 */
export function makeRow(over: Omit<Partial<LocalNote>, 'id'> & { id?: string } = {}): LocalNote {
  const n = ++seq
  const id = asNoteId(over.id ?? `n${n}`)
  const base: LocalNote = {
    id,
    title: `Note ${n}`,
    titleIsCustom: false,
    body: `Note ${n}`,
    createdAt: 1_000,
    updatedAt: 1_000,
    deletedAt: null,
    rev: asRev(`r${n}`),
    baseRev: asRev(`r${n}`),
    pendingRev: null,
    baseContent: null,
  }
  const row: LocalNote = { ...base, ...over, id }
  if (row.pendingRev !== null && row.baseRev !== null && row.baseContent === null) {
    row.baseContent = { title: base.title, titleIsCustom: false, body: base.body }
  }
  return row
}

export const id = (s: string): NoteId => asNoteId(s)

/** Resets the id/rev counter so a test's expectations do not depend on run order. */
export const resetRows = (): void => {
  seq = 0
}
