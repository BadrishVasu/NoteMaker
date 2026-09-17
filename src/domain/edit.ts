// src/domain/edit.ts
// Pure. Entering the Outbox. The rev and the timestamp are minted at the edge and passed in.

import { forkPointOf } from './note'
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
