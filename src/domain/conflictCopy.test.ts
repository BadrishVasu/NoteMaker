import { describe, it, expect } from 'vitest'
import { asDeviceId, asNoteId, asRev } from './note'
import type { NoteDoc } from './note'
import {
  COPY_ID_MAX_BYTES,
  ConflictCopyIdTooLongError,
  buildConflictCopy,
  conflictCopyId,
  mayWriteCopy,
} from './conflictCopy'
import type { Flight } from './reconcile'

/**
 * 02, appendix defect 2: the copy id AND the copy's rev are both derived from the flight
 * token. The pristine guard (`updatedAt !== createdAt`) is retired, not ported — it was
 * the bug. Ticket 01 / Builder gap 1: the id is length-checked against Firestore's
 * 1500-byte document-id cap, because a copy can itself conflict and nest the pattern.
 */

const N = asNoteId('noteA')
const DEV = asDeviceId('d3v1c3ab')

const doc = (over: Partial<NoteDoc> = {}): NoteDoc => ({
  title: 'Groceries',
  titleIsCustom: true,
  body: '- oat milk\n- eggs',
  createdAt: 1_000,
  updatedAt: 5_000,
  deletedAt: null,
  rev: asRev('R2'),
  ...over,
})

const flight = (over: Partial<Flight> = {}): Flight => ({
  noteId: N,
  deviceId: DEV,
  baseRev: asRev('R0'),
  flightRev: asRev('R2'),
  copyId: asNoteId('noteA__cd3v1c3ab__R2'),
  doc: doc(),
  baseContent: { title: 'Groceries', titleIsCustom: true, body: '- oat milk' },
  ...over,
})

describe('conflictCopyId', () => {
  it('is <noteId>__c<deviceId>__<flightRev>', () => {
    expect(conflictCopyId(N, DEV, asRev('R2'))).toBe('noteA__cd3v1c3ab__R2')
  })

  it('differs across two independent conflicts from the same device (defect 2)', () => {
    expect(conflictCopyId(N, DEV, asRev('R2'))).not.toBe(conflictCopyId(N, DEV, asRev('R3')))
  })

  it('nests for a copy of a copy', () => {
    const first = conflictCopyId(N, DEV, asRev('R2'))
    expect(conflictCopyId(first, asDeviceId('other001'), asRev('R9'))).toBe(
      'noteA__cd3v1c3ab__R2__cother001__R9',
    )
  })

  it('accepts an id of exactly the cap and rejects one byte over', () => {
    const suffix = `__c${DEV}__R2`
    const atCap = asNoteId('x'.repeat(COPY_ID_MAX_BYTES - suffix.length))
    expect(conflictCopyId(atCap, DEV, asRev('R2'))).toHaveLength(COPY_ID_MAX_BYTES)
    const over = asNoteId('x'.repeat(COPY_ID_MAX_BYTES - suffix.length + 1))
    expect(() => conflictCopyId(over, DEV, asRev('R2'))).toThrow(ConflictCopyIdTooLongError)
  })

  it('counts UTF-8 bytes, not UTF-16 code units', () => {
    const suffix = `__c${DEV}__R2`
    // 'é' is one code unit but two UTF-8 bytes: exactly the cap in code units, one over in bytes.
    const id = asNoteId('é' + 'x'.repeat(COPY_ID_MAX_BYTES - suffix.length - 1))
    expect(id.length + suffix.length).toBe(COPY_ID_MAX_BYTES)
    expect(() => conflictCopyId(id, DEV, asRev('R2'))).toThrow(ConflictCopyIdTooLongError)
  })
})

describe('buildConflictCopy', () => {
  it('carries our in-flight content, rev = flightRev, conflictOf = the surviving sibling', () => {
    const copy = buildConflictCopy(flight())
    expect(copy).toEqual({
      title: 'Groceries',
      titleIsCustom: true,
      body: '- oat milk\n- eggs',
      createdAt: 5_000,
      updatedAt: 5_000,
      deletedAt: null,
      rev: asRev('R2'),
      conflictOf: N,
      conflictBase: { title: 'Groceries', titleIsCustom: true, body: '- oat milk' },
    })
  })

  it('inherits title and titleIsCustom unchanged — no latch, no marker in the title (02)', () => {
    const copy = buildConflictCopy(flight({ doc: doc({ title: 'Derived one', titleIsCustom: false }) }))
    expect(copy.title).toBe('Derived one')
    expect(copy.titleIsCustom).toBe(false)
  })

  it('is always live, even when our in-flight content was a tombstone (02, branch 3)', () => {
    expect(buildConflictCopy(flight({ doc: doc({ deletedAt: 4_000 }) })).deletedAt).toBeNull()
  })

  it('OMITS conflictBase — the key is absent, not undefined — when baseRev is null (P-ABS)', () => {
    const copy = buildConflictCopy(flight({ baseRev: null, baseContent: null }))
    expect(Object.keys(copy)).not.toContain('conflictBase')
    expect(copy.conflictOf).toBe(N)
  })

  it('replaces, never inherits, conflictOf when the flight is itself a copy', () => {
    const parent = asNoteId('root__cother001__R1')
    const copy = buildConflictCopy(
      flight({ noteId: parent, doc: doc({ conflictOf: asNoteId('root'), conflictBase: { title: 'x', titleIsCustom: false, body: 'old' } }) }),
    )
    expect(copy.conflictOf).toBe(parent)
    expect(copy.conflictBase).toEqual(flight().baseContent)
  })

  it('refuses a flight whose base is known but whose fork-point content is missing', () => {
    expect(() => buildConflictCopy(flight({ baseContent: null }))).toThrow()
  })

  it('is deterministic — a retry builds a byte-identical document', () => {
    expect(buildConflictCopy(flight())).toEqual(buildConflictCopy(flight()))
  })
})

describe('mayWriteCopy — replaces the pristine guard (defect 2)', () => {
  it('writes into an absent document', () => {
    expect(mayWriteCopy(null, asRev('R2'))).toBe(true)
  })

  it('rewrites a document already at rev === flightRev (retry, second tab)', () => {
    expect(mayWriteCopy(doc({ rev: asRev('R2') }), asRev('R2'))).toBe(true)
  })

  it('writes nothing over a copy someone has edited since — our content is its ancestor', () => {
    expect(mayWriteCopy(doc({ rev: asRev('R7') }), asRev('R2'))).toBe(false)
  })

  it('ignores updatedAt/createdAt entirely', () => {
    expect(mayWriteCopy(doc({ rev: asRev('R2'), createdAt: 1, updatedAt: 99 }), asRev('R2'))).toBe(true)
  })
})
