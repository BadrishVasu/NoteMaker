import { describe, expect, it } from 'vitest'
import { asDeviceId, asNoteId, asRev } from '../domain/note'
import type { NoteDoc } from '../domain/note'
import { newLocalNote } from '../domain/edit'
import { beginPush, decide } from '../domain/reconcile'
import type { Flight } from '../domain/reconcile'
import { FakeServer } from './fakeGateway'
import type { SnapshotBatch } from './remoteGateway'

const UID = 'u1'
const N = asNoteId('N')
const content = { title: 'T', titleIsCustom: true, body: 'mine' }

const serverDoc = (rev: string, body: string): NoteDoc => ({
  ...content,
  body,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  rev: asRev(rev),
})

const createFlight = (rev = 'r1'): Flight => beginPush(newLocalNote(N, content, asRev(rev), 5), asDeviceId('dev0'))

function listen(server: FakeServer): SnapshotBatch[] {
  const batches: SnapshotBatch[] = []
  server.gateway().subscribeNotes(UID, (b) => batches.push(b), (e) => { throw e })
  return batches
}

describe('FakeServer transactions', () => {
  it('runs decide against the current documents and writes what it returns', async () => {
    const server = new FakeServer()
    const flight = createFlight()
    const result = await server.gateway().runPush(UID, flight, (read) => decide(flight, read))
    expect(result).toEqual({ action: { kind: 'write', branch: 'create', doc: flight.doc }, read: { note: null, copy: null } })
    expect(server.doc(UID, N)).toEqual(flight.doc)
  })

  it('reads the copy document too — the read set is {noteId, copyId}', async () => {
    const server = new FakeServer()
    const flight = createFlight()
    server.put(UID, flight.copyId, serverDoc('cr', 'copy'))
    const { read } = await server.gateway().runPush(UID, flight, (r) => decide(flight, r))
    expect(read.copy?.rev).toBe('cr')
  })

  it('retries when a read document changed between the read and the write, and returns the committed attempt', async () => {
    const server = new FakeServer()
    const flight = createFlight()
    const seen: number[] = []
    server.beforeWrite = ({ attempt }) => {
      seen.push(attempt)
      // Another device lands a document at N between attempt 1's read and its write.
      if (attempt === 1) server.put(UID, N, serverDoc('other', 'theirs'))
    }
    const result = await server.gateway().runPush(UID, flight, (r) => decide(flight, r))
    expect(seen).toEqual([1, 2])
    expect(result.read.note?.rev).toBe('other')
    expect(result.action.kind).toBe('conflictCopy')
    expect(server.doc(UID, N)?.rev).toBe('other') // attempt 1's create never landed
  })

  it('does not retry when only an unread document changed', async () => {
    const server = new FakeServer()
    const flight = createFlight()
    const seen: number[] = []
    server.beforeWrite = ({ attempt }) => {
      seen.push(attempt)
      server.put(UID, asNoteId('unrelated'), serverDoc('x', 'x'))
    }
    await server.gateway().runPush(UID, flight, (r) => decide(flight, r))
    expect(seen).toEqual([1])
  })

  it('gives up after five contended attempts', async () => {
    const server = new FakeServer()
    const flight = createFlight()
    let n = 0
    server.beforeWrite = () => server.put(UID, N, serverDoc(`c${++n}`, 'churn'))
    await expect(server.gateway().runPush(UID, flight, (r) => decide(flight, r))).rejects.toThrow(/contention/)
    expect(n).toBe(5)
  })

  it('rejects when failing, without reading or writing', async () => {
    const server = new FakeServer()
    server.failPushesWith = new Error('unavailable')
    const flight = createFlight()
    let decided = false
    await expect(
      server.gateway().runPush(UID, flight, (r) => ((decided = true), decide(flight, r))),
    ).rejects.toThrow('unavailable')
    expect(decided).toBe(false)
    expect(server.doc(UID, N)).toBeUndefined()
  })

  it('records every object handed to the transaction, and refuses a non-wire one', async () => {
    const server = new FakeServer()
    const flight = createFlight()
    await server.gateway().runPush(UID, flight, (r) => decide(flight, r))
    expect(server.handed.map((h) => h.id)).toEqual([N])
    expect(server.handed[0]?.doc).toBe(flight.doc) // the very object, not a copy

    const leaky = { ...flight, doc: { ...flight.doc, baseContent: null } as unknown as NoteDoc, flightRev: asRev('r9') }
    await expect(server.gateway().runPush(UID, leaky, () => ({ kind: 'write', branch: 'clean', doc: leaky.doc }))).rejects.toThrow(
      /non-wire field/,
    )
    expect(server.doc(UID, N)?.rev).toBe('r1')
  })

  it('isolates stored documents from the caller — no aliasing across the wire', async () => {
    const server = new FakeServer()
    const flight = createFlight()
    await server.gateway().runPush(UID, flight, (r) => decide(flight, r))
    ;(flight.doc as { body: string }).body = 'mutated after push'
    expect(server.doc(UID, N)?.body).toBe('mine')
  })
})

describe('FakeServer listener', () => {
  it('delivers a complete first batch, then changes; removals as null', async () => {
    const server = new FakeServer()
    server.put(UID, N, serverDoc('r0', 'zero'))
    const batches = listen(server)
    await server.settle()
    expect(batches).toEqual([{ fromCache: false, complete: true, changes: [{ id: N, doc: serverDoc('r0', 'zero') }] }])

    server.put(UID, N, serverDoc('r1', 'one'))
    server.remove(UID, N)
    await server.settle()
    expect(batches[1]).toEqual({ fromCache: false, complete: false, changes: [{ id: N, doc: null }] }) // coalesced
  })

  it('holds deliveries while held, and releases them as one coalesced batch', async () => {
    const server = new FakeServer()
    const batches = listen(server)
    await server.settle()
    server.hold()
    server.put(UID, N, serverDoc('r1', 'one'))
    server.put(UID, N, serverDoc('r2', 'two'))
    await server.settle()
    expect(batches).toHaveLength(1)
    server.release()
    await server.settle()
    expect(batches[1]).toEqual({ fromCache: false, complete: false, changes: [{ id: N, doc: serverDoc('r2', 'two') }] })
  })

  it('delivers per uid only, and not after unsubscribe', async () => {
    const server = new FakeServer()
    const mine: SnapshotBatch[] = []
    const unsubscribe = server.gateway().subscribeNotes(UID, (b) => mine.push(b), () => undefined)
    await server.settle()
    server.put('someone-else', N, serverDoc('x', 'x'))
    await server.settle()
    expect(mine).toHaveLength(1)
    unsubscribe()
    server.put(UID, N, serverDoc('y', 'y'))
    await server.settle()
    expect(mine).toHaveLength(1)
  })

  it('hands listeners copies, not the stored objects', async () => {
    const server = new FakeServer()
    server.put(UID, N, serverDoc('r0', 'zero'))
    const batches = listen(server)
    await server.settle()
    ;(batches[0]?.changes[0]?.doc as { body: string }).body = 'mutated'
    expect(server.doc(UID, N)?.body).toBe('zero')
  })
})
