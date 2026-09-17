// src/domain/conflictCopy.ts
// Pure. 02 appendix, defect 2: the copy id AND the copy's rev derive from the flight token.
// The pristine guard (`updatedAt !== createdAt`) is retired — it was the data-loss bug.

import { forkPointOf } from './note'
import type { DeviceId, NoteDoc, NoteId, Rev } from './note'
import type { Flight } from './reconcile'

/** Firestore's document-id cap. A copy can itself conflict and nest the id pattern. */
export const COPY_ID_MAX_BYTES = 1500

export class ConflictCopyIdTooLongError extends Error {
  constructor(readonly bytes: number) {
    super(`Conflict copy id is ${bytes} bytes; Firestore caps a document id at ${COPY_ID_MAX_BYTES}.`)
    this.name = 'ConflictCopyIdTooLongError'
  }
}

/** UTF-8 length without TextEncoder — `domain/` touches no platform API. */
function utf8Bytes(s: string): number {
  let bytes = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
  }
  return bytes
}

/** `<noteId>__c<deviceId>__<flightRev>`, length-checked. */
export function conflictCopyId(noteId: NoteId, deviceId: DeviceId, flightRev: Rev): NoteId {
  const id = `${noteId}__c${deviceId}__${flightRev}`
  const bytes = utf8Bytes(id)
  if (bytes > COPY_ID_MAX_BYTES) throw new ConflictCopyIdTooLongError(bytes)
  return id as NoteId
}

/**
 * The copy document: our in-flight content, always live, `rev = flightRev`, pointing at
 * the surviving sibling, carrying the fork point. Title and `titleIsCustom` are inherited
 * unchanged (02). Deterministic in the flight alone, so a retry writes identical bytes.
 *
 * Both timestamps are the in-flight content's `updatedAt`: the copy's content was authored
 * then, and taking it from the flight keeps the document identical across retries.
 */
export function buildConflictCopy(flight: Flight): NoteDoc {
  const copy: NoteDoc = {
    ...forkPointOf(flight.doc),
    createdAt: flight.doc.updatedAt,
    updatedAt: flight.doc.updatedAt,
    deletedAt: null,
    rev: flight.flightRev,
    conflictOf: flight.noteId,
  }
  if (flight.baseRev !== null) {
    // P-ABS: a copy is born without conflictBase only when the flight's baseRev is null.
    if (flight.baseContent === null) {
      throw new Error(
        `Flight ${flight.flightRev} on ${flight.noteId} has baseRev ${flight.baseRev} but no ` +
          `baseContent — refusing to write a Conflict copy with a missing fork point.`,
      )
    }
    copy.conflictBase = forkPointOf(flight.baseContent)
  }
  return copy
}

/** Write the copy only into an absent document or one already at our flight token. Any
 *  other rev means someone edited the copy since, and our content is its ancestor. */
export const mayWriteCopy = (existing: NoteDoc | null, flightRev: Rev): boolean =>
  existing === null || existing.rev === flightRev
