// src/domain/applySnapshot.ts
// Pure. 02 appendix: the complete `applySnapshot(localRow, serverDoc)` table, cell by cell.
//
// Takes no in-flight argument on purpose: cells 11–14 (dirty, push in flight) are
// identical to 7–10, and the signature is what guarantees it.
//
// The engine also records `serverDoc` into `lastServerState` for EVERY cell (present ⇒ set,
// absent ⇒ delete) — defect 1's fix, and the only thing a snapshot does for a dirty row.

import { sameContent } from './note'
import type { LocalNote, NoteDoc, NoteId, RowWrite } from './note'

export class SyncInvariantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncInvariantError'
  }
}

const sameRevContent = (row: LocalNote, doc: NoteDoc): boolean =>
  sameContent(row, doc) && row.deletedAt === doc.deletedAt

/** A clean row built from a delivered document. Explicit — nothing from an old row survives. */
export function cleanRowFromServer(id: NoteId, doc: NoteDoc): LocalNote {
  const row: LocalNote = {
    id,
    title: doc.title,
    titleIsCustom: doc.titleIsCustom,
    body: doc.body,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    deletedAt: doc.deletedAt,
    rev: doc.rev,
    baseRev: doc.rev,
    pendingRev: null,
    baseContent: null,
  }
  if (doc.conflictOf !== undefined) row.conflictOf = doc.conflictOf
  if (doc.conflictBase !== undefined) row.conflictBase = doc.conflictBase
  return row
}

export function applySnapshot(local: LocalNote | undefined, id: NoteId, server: NoteDoc | null): RowWrite[] {
  if (local === undefined) {
    // cell 1: no-op · cell 2: insert clean
    return server === null ? [] : [{ op: 'put', row: cleanRowFromServer(id, server) }]
  }

  if (local.pendingRev === null) {
    if (server === null) return [{ op: 'delete', id }] // cell 3
    if (server.rev === local.baseRev) {
      // cell 4 (cell 5 — clean × rev === pendingRev — is unrepresentable: pendingRev is null)
      if (!sameRevContent(local, server)) {
        throw new SyncInvariantError(`Clean row ${id} at ${server.rev} disagrees with the delivered doc at the same rev.`)
      }
      return []
    }
    return [{ op: 'put', row: cleanRowFromServer(id, server) }] // cell 6
  }

  // Dirty. Cells 7, 8, 10 are no-ops: keep content, keep baseRev, keep baseContent.
  if (server === null || server.rev !== local.pendingRev) return []

  // cell 9: our own write returning.
  if (!sameRevContent(local, server)) {
    throw new SyncInvariantError(`Row ${id}: the delivered doc at our pendingRev ${server.rev} is not our content.`)
  }
  return [{ op: 'put', row: { ...local, baseRev: server.rev, pendingRev: null, baseContent: null } }]
}
