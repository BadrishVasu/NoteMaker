import { describe, it, expect } from 'vitest'
import { asDeviceId, asNoteId, asRev } from './note'
import type { ForkPoint, LocalNote, NoteDoc } from './note'
import { beginPush, commitPush, decide } from './reconcile'
import type { Flight, PushAction } from './reconcile'
import { buildConflictCopy } from './conflictCopy'

/**
 * Ticket 02's push, as three pure steps the engine sequences:
 *
 *   beginPush  — row → Flight. Everything the transaction needs, closed over as data.
 *   decide     — Flight × the transaction's read → PushAction. Runs INSIDE runTransaction,
 *                so it must be pure and safely re-runnable (architecture, "the one bet").
 *   commitPush — Flight × PushAction × the local rows NOW → row writes. Local bookkeeping;
 *                where the `baseContent` capture rule (02 appendix 3) lives.
 *
 * Unit tables here. The lineage property and Gaps A/B/C are in `sync.lineage.test.ts`,
 * over the fixture that remembers content per rev.
 */

const N = asNoteId('noteA')
const DEV = asDeviceId('dev00001')
const COPY = asNoteId('noteA__cdev00001__R2')

const fp = (body: string): ForkPoint => ({ title: 'Groceries', titleIsCustom: true, body })

const doc = (rev: string, body: string, over: Partial<NoteDoc> = {}): NoteDoc => ({
  ...fp(body),
  createdAt: 1_000,
  updatedAt: 2_000,
  deletedAt: null,
  rev: asRev(rev),
  ...over,
})

const row = (over: Partial<LocalNote> & Pick<LocalNote, 'rev'>): LocalNote => ({
  ...fp('mine'),
  createdAt: 1_000,
  updatedAt: 2_000,
  deletedAt: null,
  id: N,
  baseRev: asRev('R0'),
  pendingRev: over.rev,
  baseContent: fp('base'),
  ...over,
})

/** Dirty at R0 ('base'), pushing R2 ('mine'). */
const R2 = row({ rev: asRev('R2') })
const flight = (over: Partial<LocalNote> = {}): Flight => beginPush({ ...R2, ...over }, DEV)

describe('beginPush', () => {
  it('closes over base, flight token, the wire doc, the fork point and the copy id', () => {
    expect(flight()).toEqual({
      noteId: N,
      deviceId: DEV,
      baseRev: asRev('R0'),
      flightRev: asRev('R2'),
      copyId: COPY,
      doc: doc('R2', 'mine'),
      baseContent: fp('base'),
    })
  })

  it('the flight doc goes through toNoteDoc — no local field reaches the wire', () => {
    expect(Object.keys(flight().doc).sort()).toEqual(
      ['body', 'createdAt', 'deletedAt', 'rev', 'title', 'titleIsCustom', 'updatedAt'].sort(),
    )
  })

  it('refuses a clean row — there is nothing to push', () => {
    expect(() => beginPush({ ...R2, pendingRev: null, baseContent: null, baseRev: asRev('R2') }, DEV)).toThrow()
  })
})

describe('decide — the three equality tests', () => {
  it('srv.rev === pendingRev → landed (retry, lost response, second tab); writes nothing', () => {
    expect(decide(flight(), { note: doc('R2', 'mine'), copy: null })).toEqual({ kind: 'landed' })
  })

  it('srv.rev === baseRev → clean push of our doc under rev = pendingRev', () => {
    expect(decide(flight(), { note: doc('R0', 'base'), copy: null })).toEqual({
      kind: 'write',
      branch: 'clean',
      doc: doc('R2', 'mine'),
    })
  })
})

describe('decide — server document absent (02 appendix: recreate, not a conflict copy)', () => {
  it('baseRev null → ordinary create', () => {
    const f = flight({ baseRev: null, baseContent: null })
    expect(decide(f, { note: null, copy: null })).toEqual({ kind: 'write', branch: 'create', doc: doc('R2', 'mine') })
  })

  it('a flight that is a delete → outcomes agree; write nothing, adopt absence', () => {
    const f = flight({ deletedAt: 3_000 })
    expect(decide(f, { note: null, copy: null })).toEqual({ kind: 'adopt', branch: 'deleteGone' })
  })

  it('otherwise → recreate at noteId under rev = pendingRev', () => {
    expect(decide(flight(), { note: null, copy: null })).toEqual({ kind: 'write', branch: 'recreate', doc: doc('R2', 'mine') })
  })
})

describe('decide — the conflict branch, in order', () => {
  it('1. fast-forward: same content and same deletedness → adopt, write nothing', () => {
    expect(decide(flight(), { note: doc('R9', 'mine'), copy: null })).toEqual({ kind: 'adopt', branch: 'fastForward' })
  })

  it('1. deletedAt compares as a boolean — two deletes with different millis fast-forward', () => {
    const f = flight({ deletedAt: 3_000 })
    expect(decide(f, { note: doc('R9', 'mine', { deletedAt: 4_000 }), copy: null })).toEqual({
      kind: 'adopt',
      branch: 'fastForward',
    })
  })

  it('1. same content but different deletedness is NOT a fast-forward', () => {
    expect(decide(flight(), { note: doc('R9', 'mine', { deletedAt: 4_000 }), copy: null }).kind).toBe('conflictCopy')
  })

  it('2. our delete lost to their edit → adopt; the delete is dropped', () => {
    const f = flight({ deletedAt: 3_000 })
    expect(decide(f, { note: doc('R9', 'theirs'), copy: null })).toEqual({ kind: 'adopt', branch: 'deleteLost' })
  })

  it('3. our edit lost → write a live copy; noteId is never written', () => {
    const f = flight()
    expect(decide(f, { note: doc('R9', 'theirs'), copy: null })).toEqual({
      kind: 'conflictCopy',
      copyId: COPY,
      copy: buildConflictCopy(f),
    })
  })

  it('3. even when the winner is a tombstone, the copy is live', () => {
    const a = decide(flight(), { note: doc('R9', 'theirs', { deletedAt: 5_000 }), copy: null })
    expect(a.kind === 'conflictCopy' && a.copy?.deletedAt).toBeNull()
  })

  it('3. the copy already at rev === flightRev → rewrite, idempotently', () => {
    const f = flight()
    expect(decide(f, { note: doc('R9', 'theirs'), copy: buildConflictCopy(f) })).toEqual({
      kind: 'conflictCopy',
      copyId: COPY,
      copy: buildConflictCopy(f),
    })
  })

  it('3. the copy edited since (other rev) → write nothing; our content is its ancestor', () => {
    expect(decide(flight(), { note: doc('R9', 'theirs'), copy: doc('R7', 'edited copy') })).toEqual({
      kind: 'conflictCopy',
      copyId: COPY,
      copy: null,
    })
  })

  it('3. baseRev null (our create landed, response lost, they edited) → copy with no conflictBase', () => {
    const a = decide(flight({ baseRev: null, baseContent: null }), { note: doc('R9', 'theirs'), copy: null })
    expect(a.kind === 'conflictCopy' && a.copy && 'conflictBase' in a.copy).toBe(false)
  })

  it('is pure and re-runnable: frozen inputs, identical output on a second run', () => {
    const f = Object.freeze(flight())
    const read = Object.freeze({ note: Object.freeze(doc('R9', 'theirs')), copy: null })
    expect(decide(f, read)).toEqual(decide(f, read))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// commitPush
// ─────────────────────────────────────────────────────────────────────────────

const write = (branch: 'clean' | 'create' | 'recreate'): PushAction => ({ kind: 'write', branch, doc: doc('R2', 'mine') })
const LANDED_KINDS: PushAction[] = [write('clean'), write('create'), write('recreate'), { kind: 'landed' }]
const ADOPT_KINDS: PushAction[] = [
  { kind: 'adopt', branch: 'fastForward' },
  { kind: 'adopt', branch: 'deleteLost' },
  { kind: 'adopt', branch: 'deleteGone' },
]

/** The row after the user typed 'typed' during the flight, under R3. */
const TYPED = row({ rev: asRev('R3'), body: 'typed', updatedAt: 3_000 })
const THEIRS = doc('R9', 'theirs', { updatedAt: 9_000 })
const cleanFrom = (id: typeof N, d: NoteDoc): LocalNote => ({ ...d, id, baseRev: d.rev, pendingRev: null, baseContent: null })

describe('commitPush — nothing to do', () => {
  it.each([...LANDED_KINDS, ...ADOPT_KINDS])('local row gone → no writes (%o)', (action) => {
    expect(commitPush(flight(), action, { row: undefined, copyRow: undefined }, THEIRS)).toEqual([])
  })

  it.each([...LANDED_KINDS, ...ADOPT_KINDS])('local row already clean (snapshot cell 9, second tab) → no-op (%o)', (action) => {
    const alreadyClean = { ...R2, baseRev: asRev('R2'), pendingRev: null, baseContent: null }
    expect(commitPush(flight(), action, { row: alreadyClean, copyRow: undefined }, THEIRS)).toEqual([])
  })
})

describe('commitPush — branches that landed our content at noteId: baseRev := flightRev', () => {
  it.each(LANDED_KINDS)('nothing typed → row goes clean, baseContent := null (%o)', (action) => {
    expect(commitPush(flight(), action, { row: R2, copyRow: undefined }, THEIRS)).toEqual([
      { op: 'put', row: { ...R2, baseRev: asRev('R2'), pendingRev: null, baseContent: null } },
    ])
  })

  it.each(LANDED_KINDS)('typed during flight → stays dirty, baseContent := the in-flight content (%o)', (action) => {
    expect(commitPush(flight(), action, { row: TYPED, copyRow: undefined }, THEIRS)).toEqual([
      { op: 'put', row: { ...TYPED, baseRev: asRev('R2'), baseContent: fp('mine') } },
    ])
  })

  it('create landing with typing (Gap B shape): baseContent goes null → in-flight content', () => {
    const create = row({ rev: asRev('R2'), baseRev: null, baseContent: null })
    const typed = { ...create, rev: asRev('R3'), pendingRev: asRev('R3'), body: 'typed' }
    expect(commitPush(beginPush(create, DEV), write('create'), { row: typed, copyRow: undefined }, null)).toEqual([
      { op: 'put', row: { ...typed, baseRev: asRev('R2'), baseContent: fp('mine') } },
    ])
  })
})

describe('commitPush — branches that did not write our content', () => {
  it.each(ADOPT_KINDS)('nothing typed → adopt the server view clean (%o)', (action) => {
    expect(commitPush(flight(), action, { row: R2, copyRow: undefined }, THEIRS)).toEqual([
      { op: 'put', row: cleanFrom(N, THEIRS) },
    ])
  })

  it.each(ADOPT_KINDS)('nothing typed and the server view is absent → delete the local row (%o)', (action) => {
    expect(commitPush(flight(), action, { row: R2, copyRow: undefined }, null)).toEqual([{ op: 'delete', id: N }])
  })

  it.each(ADOPT_KINDS)('typed during flight → no-op: never adopt, never advance baseRev (%o)', (action) => {
    expect(commitPush(flight(), action, { row: TYPED, copyRow: undefined }, THEIRS)).toEqual([])
  })
})

describe('commitPush — conflict copy and the Outbox-slot migration (02 defect 3, appendix 3 point 3)', () => {
  const f = flight()
  const COPY_DOC = buildConflictCopy(f)
  const wrote: PushAction = { kind: 'conflictCopy', copyId: COPY, copy: COPY_DOC }
  const superseded: PushAction = { kind: 'conflictCopy', copyId: COPY, copy: null }

  it('nothing typed, copy row absent → noteId adopts; copy row born clean at flightRev', () => {
    expect(commitPush(f, wrote, { row: R2, copyRow: undefined }, THEIRS)).toEqual([
      { op: 'put', row: cleanFrom(N, THEIRS) },
      { op: 'put', row: cleanFrom(COPY, COPY_DOC) },
    ])
  })

  it('typed, copy row absent → slot migrates: copy row dirty at baseRev := flightRev, baseContent := in-flight content', () => {
    expect(commitPush(f, wrote, { row: TYPED, copyRow: undefined }, THEIRS)).toEqual([
      { op: 'put', row: cleanFrom(N, THEIRS) },
      {
        op: 'put',
        row: {
          ...COPY_DOC,
          ...fp('typed'),
          updatedAt: 3_000,
          deletedAt: null,
          rev: asRev('R3'),
          id: COPY,
          baseRev: asRev('R2'),
          pendingRev: asRev('R3'),
          baseContent: fp('mine'),
        },
      },
    ])
  })

  it('the migrated baseContent is the copy content at flightRev, NOT the conflictBase just written', () => {
    // The copy's conflictBase is the fork point of noteId (R0, 'base'). The migrated row's
    // baseRev is the COPY's rev (R2), whose content is 'mine'. Lineage is per row, per baseRev.
    const [, migrated] = commitPush(f, wrote, { row: TYPED, copyRow: undefined }, THEIRS)
    expect(migrated?.op === 'put' && migrated.row.baseContent).toEqual(fp('mine'))
    expect(COPY_DOC.conflictBase).toEqual(fp('base'))
  })

  it('typed, copy row present and exactly the pristine copy (clean at flightRev) → migrates', () => {
    const pristine = cleanFrom(COPY, COPY_DOC)
    const writes = commitPush(f, wrote, { row: TYPED, copyRow: pristine }, THEIRS)
    expect(writes).toHaveLength(2)
    expect(writes[1]).toMatchObject({ op: 'put', row: { id: COPY, baseRev: asRev('R2'), pendingRev: asRev('R3') } })
  })

  it('typed, copy row already edited (dirty) → target not free: nothing moves', () => {
    const editedCopy = { ...cleanFrom(COPY, COPY_DOC), pendingRev: asRev('R5'), rev: asRev('R5'), baseContent: fp('mine') }
    expect(commitPush(f, wrote, { row: TYPED, copyRow: editedCopy }, THEIRS)).toEqual([])
  })

  it('typed, copy row clean at a NEWER rev → target not free: nothing moves', () => {
    const newer = cleanFrom(COPY, { ...COPY_DOC, rev: asRev('R6'), body: 'their edit of the copy' })
    expect(commitPush(f, wrote, { row: TYPED, copyRow: newer }, THEIRS)).toEqual([])
  })

  it('nothing typed, target not free → noteId adopts, copy row untouched', () => {
    const newer = cleanFrom(COPY, { ...COPY_DOC, rev: asRev('R6'), body: 'their edit of the copy' })
    expect(commitPush(f, wrote, { row: R2, copyRow: newer }, THEIRS)).toEqual([{ op: 'put', row: cleanFrom(N, THEIRS) }])
  })

  it('superseded (this push wrote nothing) is never a migration target', () => {
    expect(commitPush(f, superseded, { row: TYPED, copyRow: undefined }, THEIRS)).toEqual([])
    expect(commitPush(f, superseded, { row: R2, copyRow: undefined }, THEIRS)).toEqual([
      { op: 'put', row: cleanFrom(N, THEIRS) },
    ])
  })

  it('nothing typed and the server view of noteId is gone → delete noteId, still keep the copy', () => {
    expect(commitPush(f, wrote, { row: R2, copyRow: undefined }, null)).toEqual([
      { op: 'delete', id: N },
      { op: 'put', row: cleanFrom(COPY, COPY_DOC) },
    ])
  })
})
