import { describe, expect, it } from 'vitest'
import { asNoteId, asRev } from '../domain/note'
import type { LocalNote, NoteDoc } from '../domain/note'
import { assertWireDoc } from './remoteGateway'

const doc: NoteDoc = {
  title: 'T',
  titleIsCustom: true,
  body: 'b',
  createdAt: 1,
  updatedAt: 2,
  deletedAt: null,
  rev: asRev('r1'),
}

const copy: NoteDoc = { ...doc, conflictOf: asNoteId('N'), conflictBase: { title: 'T', titleIsCustom: true, body: 'a' } }

/**
 * The `LocalNote extends NoteDoc` leak guard's runtime half: every object a gateway hands a
 * transaction passes through this. 01's rules are a closed allowlist, so a leaked field is a
 * denied write, which presents as a permanently stuck Outbox — this makes it loud instead.
 */
describe('assertWireDoc', () => {
  it('accepts an ordinary Note: exactly the seven required keys', () => {
    expect(() => assertWireDoc(doc)).not.toThrow()
  })

  it('accepts a fully populated Conflict copy: all nine keys', () => {
    expect(() => assertWireDoc(copy)).not.toThrow()
  })

  it('rejects a whole mirror row — the leak `extends` makes typecheck', () => {
    const row: LocalNote = { ...doc, id: asNoteId('N'), baseRev: asRev('r1'), pendingRev: null, baseContent: null }
    expect(() => assertWireDoc(row)).toThrow(/baseContent|baseRev|pendingRev|id/)
  })

  it.each(['title', 'titleIsCustom', 'body', 'createdAt', 'updatedAt', 'deletedAt', 'rev'])('rejects a doc missing %s', (key) => {
    const partial: Record<string, unknown> = { ...doc }
    delete partial[key]
    expect(() => assertWireDoc(partial as unknown as NoteDoc)).toThrow(key)
  })

  it('rejects an optional field present as undefined — Firestore throws on it inside the transaction', () => {
    expect(() => assertWireDoc({ ...doc, conflictOf: undefined } as unknown as NoteDoc)).toThrow('conflictOf')
  })

  it('rejects a conflictBase carrying anything beyond the three content fields', () => {
    const leaky = { ...copy, conflictBase: { ...copy.conflictBase, deletedAt: null } } as unknown as NoteDoc
    expect(() => assertWireDoc(leaky)).toThrow('conflictBase')
  })
})
