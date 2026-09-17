// src/domain/reconcile.ts
// Pure. Ticket 02's push as three steps the engine sequences:
//
//   beginPush  — row → Flight: everything the transaction needs, closed over as data.
//   decide     — runs INSIDE runTransaction. Must be pure and safely re-runnable: Firestore
//                re-executes the callback on contention.
//   commitPush — local bookkeeping after the transaction resolved. Home of the corrected
//                `baseContent` capture rule (02 appendix 3), stated once:
//
//     baseContent := the in-flight content wherever baseRev := flightRev and the row stays
//     dirty; baseContent := null wherever the row goes clean.
//
// commitPush sits here rather than in `sync/engine.ts` (architecture's module table) so the
// capture rule and Gaps A/B/C are tested as pure units at step 3. The engine applies its
// RowWrites; it does not re-derive them.

import { forkPointOf, sameContent, toNoteDoc } from './note'
import type { DeviceId, ForkPoint, LocalNote, NoteDoc, NoteId, Rev, RowWrite, ServerState } from './note'
import { buildConflictCopy, conflictCopyId, mayWriteCopy } from './conflictCopy'
import { cleanRowFromServer } from './applySnapshot'

export interface Flight {
  noteId: NoteId
  deviceId: DeviceId
  /** The row's baseRev when the push began; null for an unlanded create. */
  baseRev: Rev | null
  /** The row's pendingRev when the push began — the token this content is written under. */
  flightRev: Rev
  /** Where a Conflict copy of this flight would live. Read by the transaction, always. */
  copyId: NoteId
  /** The wire document for the in-flight content, `rev === flightRev`. */
  doc: NoteDoc
  /** The content at `baseRev`; becomes the copy's `conflictBase`. */
  baseContent: ForkPoint | null
}

export function beginPush(row: LocalNote, deviceId: DeviceId): Flight {
  if (row.pendingRev === null) throw new Error(`Row ${row.id} is clean; there is nothing to push.`)
  return {
    noteId: row.id,
    deviceId,
    baseRev: row.baseRev,
    flightRev: row.pendingRev,
    copyId: conflictCopyId(row.id, deviceId, row.pendingRev),
    doc: { ...toNoteDoc(row), rev: row.pendingRev },
    baseContent: row.baseContent,
  }
}

/** The transaction's read set: `{noteId, copyId}` — 02's per-Note independence argument. */
export interface TransactionRead {
  note: NoteDoc | null
  copy: NoteDoc | null
}

export type PushAction =
  /** Our content is written at noteId under flightRev. */
  | { kind: 'write'; branch: 'clean' | 'create' | 'recreate'; doc: NoteDoc }
  /** Our content is already at noteId under flightRev. Write nothing. */
  | { kind: 'landed' }
  /** Our content is not written and not owed a copy. Write nothing. */
  | { kind: 'adopt'; branch: 'fastForward' | 'deleteLost' | 'deleteGone' }
  /** Our edit lost. `copy` is written at `copyId`; null when superseded (write nothing). */
  | { kind: 'conflictCopy'; copyId: NoteId; copy: NoteDoc | null }

const isDelete = (d: NoteDoc): boolean => d.deletedAt !== null

export function decide(flight: Flight, read: TransactionRead): PushAction {
  const srv = read.note

  if (srv === null) {
    if (flight.baseRev === null) return { kind: 'write', branch: 'create', doc: flight.doc }
    if (isDelete(flight.doc)) return { kind: 'adopt', branch: 'deleteGone' }
    return { kind: 'write', branch: 'recreate', doc: flight.doc }
  }

  if (srv.rev === flight.flightRev) return { kind: 'landed' }
  if (srv.rev === flight.baseRev) return { kind: 'write', branch: 'clean', doc: flight.doc }

  // Conflict, in order.
  if (sameContent(srv, flight.doc) && isDelete(srv) === isDelete(flight.doc)) {
    return { kind: 'adopt', branch: 'fastForward' }
  }
  if (isDelete(flight.doc)) return { kind: 'adopt', branch: 'deleteLost' }
  return {
    kind: 'conflictCopy',
    copyId: flight.copyId,
    copy: mayWriteCopy(read.copy, flight.flightRev) ? buildConflictCopy(flight) : null,
  }
}

export interface LocalRowsNow {
  /** The row at flight.noteId as it stands at commit — the user may have typed meanwhile. */
  row: LocalNote | undefined
  /** The row at flight.copyId as it stands at commit. Only read for `conflictCopy`. */
  copyRow: LocalNote | undefined
}

/** Adopt the server view of noteId: a clean row, or deletion when the view says it's gone. */
const adopt = (id: NoteId, server: ServerState | null): RowWrite =>
  server === null ? { op: 'delete', id } : { op: 'put', row: cleanRowFromServer(id, server) }

/**
 * @param server the view to adopt noteId from: the `lastServerState` entry (null = gone),
 *   or the transaction's read while `initialSyncCompletedAt` is unset (02 defect 1). The
 *   engine chooses; this function does not know which it got.
 */
export function commitPush(flight: Flight, action: PushAction, local: LocalRowsNow, server: ServerState | null): RowWrite[] {
  const cur = local.row
  // Already clean (snapshot cell 9, a second tab) or gone: the other path did the work.
  if (cur === undefined || cur.pendingRev === null) return []
  const typed = cur.pendingRev !== flight.flightRev

  switch (action.kind) {
    case 'write':
    case 'landed':
      // baseRev := flightRev. Four branches, one rule (Gaps A and B live here).
      return [
        {
          op: 'put',
          row: typed
            ? { ...cur, baseRev: flight.flightRev, baseContent: forkPointOf(flight.doc) }
            : { ...cur, baseRev: flight.flightRev, pendingRev: null, baseContent: null },
        },
      ]

    case 'adopt':
      // Did not write our content: never adopt, never advance, unless the row is still
      // exactly what we pushed (02 defect 3's generalised rule).
      return typed ? [] : [adopt(cur.id, server)]

    case 'conflictCopy': {
      const copy = action.copy
      const cr = local.copyRow
      // The slot migrates only onto the copy THIS push just wrote (defect 3).
      const free = copy !== null && (cr === undefined || (cr.pendingRev === null && cr.baseRev === flight.flightRev))

      if (!typed) {
        const writes: RowWrite[] = [adopt(cur.id, server)]
        if (free) writes.push({ op: 'put', row: cleanRowFromServer(action.copyId, copy) })
        return writes
      }
      if (!free) return [] // stays dirty at its old base; next push mints a new copy

      // Migration with typing (Gap C lives here): the copy row takes the typed content,
      // baseRev := flightRev, baseContent := the in-flight content — the copy's content at
      // flightRev, which is NOT the copy's conflictBase (that is noteId's fork point).
      const migrated: LocalNote = {
        ...cleanRowFromServer(action.copyId, copy),
        ...forkPointOf(cur),
        deletedAt: cur.deletedAt,
        updatedAt: cur.updatedAt,
        rev: cur.pendingRev,
        pendingRev: cur.pendingRev,
        baseContent: forkPointOf(flight.doc),
      }
      return [adopt(cur.id, server), { op: 'put', row: migrated }]
    }
  }
}
