// src/domain/edit.ts
// Pure. Entering the Outbox. The rev and the timestamp are minted at the edge and passed in.

import { forkPointOf, sameContent } from './note'
import type { ForkPoint, LocalNote, NoteDoc, NoteId, Rev } from './note'

/** The user-editable part of a Note: its content plus the Trash toggle. */
export type NoteContent = ForkPoint & Pick<NoteDoc, 'deletedAt'>

/**
 * Applies one edit (a keystroke's worth, a delete, or a restore). `pendingRev` is minted on
 * every edit in both Auto sync and manual modes (02, manual-send amendment).
 *
 * Capture point 1 of 02 appendix 3: clean → dirty sets `baseContent` to the content before
 * the edit. A row already dirty keeps it — its `baseRev` has not moved.
 */
export function recordEdit(row: LocalNote, next: NoteContent, rev: Rev, updatedAt: number): LocalNote {
  let baseContent = row.baseContent
  if (row.pendingRev === null) {
    if (row.baseRev === null) {
      throw new Error(`Row ${row.id} is clean with no baseRev — P-CLEAN violated; refusing to edit.`)
    }
    baseContent = forkPointOf(row)
  }
  return {
    ...row,
    ...forkPointOf(next),
    deletedAt: next.deletedAt,
    updatedAt,
    rev,
    pendingRev: rev,
    baseContent,
  }
}

/** A brand-new Note: dirty, never landed, no fork point. */
export function newLocalNote(id: NoteId, content: ForkPoint, rev: Rev, createdAt: number): LocalNote {
  return {
    id,
    ...forkPointOf(content),
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    rev,
    baseRev: null,
    pendingRev: rev,
    baseContent: null,
  }
}

/** 02's fast-forward predicate: the same content and the same side of the Trash. Revs and
 *  timestamps are not what the user sees, so they are not compared. */
export function sameVisible(a: NoteContent, b: NoteContent): boolean {
  return sameContent(a, b) && (a.deletedAt === null) === (b.deletedAt === null)
}

/**
 * An edit commit from the editor buffer (02, amendment 2026-09-21, rule 3). `base` is the row the
 * buffer derives from; `stored` is the row as the commit's transaction reads it.
 *
 * - `stored` still shows `base` → an ordinary edit onto `stored`, keeping whatever bookkeeping the
 *   engine gave it (our own push made it clean; a fast-forward adopt changed only its rev).
 * - Otherwise (adopted underneath, trashed remotely, or gone) the edit is concurrent: record it
 *   against `base` — `baseRev := base.rev`, `baseContent :=` base's content — so its push reaches
 *   the conflict branch instead of the clean branch that would overwrite the other device. An
 *   absent row is recreated, never dropped.
 */
export function bufferEdit(
  id: NoteId,
  stored: LocalNote | undefined,
  base: LocalNote,
  next: NoteContent,
  rev: Rev,
  updatedAt: number,
): LocalNote {
  const onto =
    stored !== undefined && sameVisible(stored, base)
      ? stored
      : { ...base, id, baseRev: base.rev, pendingRev: null, baseContent: null }
  return recordEdit(onto, next, rev, updatedAt)
}
