// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asDeviceId, asNoteId, asRev, forkPointOf } from '../domain/note'
import type { LocalNote, NoteDoc, NoteId } from '../domain/note'
import { newLocalNote, recordEdit } from '../domain/edit'
import { deleteMemoryNoteStore, openMemoryNoteStore } from '../store/memoryNoteStore'
import type { NoteStore } from '../store/noteStore'
import { ManualClock } from '../test/manualClock'
import { FakeServer } from './fakeGateway'
import { PermanentPushError } from './remoteGateway'
import { BACKOFF_MAX_MS, BACKOFF_MIN_MS, PUSH_TIMEOUT_MS, createSyncEngine } from './engine'
import type { SyncEngine, SyncProblem } from './engine'

// Ticket 09's bulk: two devices are two engine instances, each with its own store, sharing one
// FakeServer. Interleavings are driven by the server's hooks, time by a ManualClock.

const UID = 'u1'
const N = asNoteId('N')
const WIRE_KEYS = ['body', 'createdAt', 'deletedAt', 'rev', 'title', 'titleIsCustom', 'updatedAt']
const COPY_KEYS = [...WIRE_KEYS, 'conflictBase', 'conflictOf'].sort()

let server: FakeServer
let clock: ManualClock
const opened: Device[] = []

interface Device {
  name: string
  store: NoteStore
  engine: SyncEngine
  problems: SyncProblem[]
  autoSync: boolean
  create(id: NoteId, body: string): Promise<void>
  edit(id: NoteId, body: string): Promise<void>
  del(id: NoteId): Promise<void>
  row(id: NoteId): Promise<LocalNote | undefined>
}

let revs = 0

async function device(name: string, opts: { start?: boolean } = {}): Promise<Device> {
  await deleteMemoryNoteStore(name)
  const store = await openMemoryNoteStore(name)
  await store.setMeta('deviceId', asDeviceId(name))
  const dev: Device = {
    name,
    store,
    problems: [],
    autoSync: true,
    engine: undefined as unknown as SyncEngine,
    async create(id, body) {
      await store.put(newLocalNote(id, { title: 'T', titleIsCustom: true, body }, asRev(`${name}${++revs}`), revs))
      dev.engine.wake()
    },
    async edit(id, body) {
      await store.runInTransaction(async (tx) => {
        const row = await tx.get(id)
        if (row === undefined) throw new Error(`${name} has no row ${id}`)
        await tx.put(recordEdit(row, { ...forkPointOf(row), body, deletedAt: row.deletedAt }, asRev(`${name}${++revs}`), revs))
      })
      dev.engine.wake()
    },
    async del(id) {
      await store.runInTransaction(async (tx) => {
        const row = await tx.get(id)
        if (row === undefined) throw new Error(`${name} has no row ${id}`)
        await tx.put(recordEdit(row, { ...forkPointOf(row), deletedAt: revs + 1 }, asRev(`${name}${++revs}`), revs))
      })
      dev.engine.wake()
    },
    row: (id) => store.get(id),
  }
  dev.engine = createSyncEngine({
    uid: UID,
    store,
    gateway: server.gateway(),
    clock,
    autoSync: () => dev.autoSync,
    onProblem: (p) => dev.problems.push(p),
  })
  opened.push(dev)
  if (opts.start !== false) {
    await dev.engine.start()
    await server.settle(10)
  }
  return dev
}

const settle = () => server.settle(10)

const serverDoc = (rev: string, body: string, extra: Partial<NoteDoc> = {}): NoteDoc => ({
  title: 'T',
  titleIsCustom: true,
  body,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  rev: asRev(rev),
  ...extra,
})

const cleanRow = (id: NoteId, doc: NoteDoc): LocalNote => ({ ...doc, id, baseRev: doc.rev, pendingRev: null, baseContent: null })

/** Every device's mirror equals the server, row for row, and nothing is dirty. */
async function expectConverged(...devices: Device[]): Promise<void> {
  const expected = server
    .ids(UID)
    .map((id) => cleanRow(id, server.doc(UID, id)!))
    .sort((a, b) => a.id.localeCompare(b.id))
  for (const d of devices) {
    const rows = (await d.store.getAll()).sort((a, b) => a.id.localeCompare(b.id))
    expect(rows, `${d.name} mirror`).toEqual(expected)
  }
}

/** A deferred the test resolves by hand — holds a transaction between its read and its write. */
function gate() {
  let open!: () => void
  const promise = new Promise<void>((resolve) => (open = resolve))
  return { promise, open }
}

beforeEach(() => {
  server = new FakeServer()
  clock = new ManualClock()
  revs = 0
})

afterEach(async () => {
  for (const d of opened.splice(0)) {
    d.engine.stop()
    await deleteMemoryNoteStore(d.name)
  }
})

/** A and B both hold N, clean, at r0 on the server. */
async function syncedPair(): Promise<[Device, Device]> {
  server.put(UID, N, serverDoc('r0', 'zero'))
  const a = await device('devA')
  const b = await device('devB')
  await settle()
  return [a, b]
}

describe('two devices, one server — ticket 09 coverage', () => {
  it('clean sync: a Note created on one device lands on the other', async () => {
    const a = await device('devA')
    const b = await device('devB')
    await a.create(N, 'hello')
    await settle()
    expect(server.doc(UID, N)?.body).toBe('hello')
    expect((await b.row(N))?.body).toBe('hello')
    await expectConverged(a, b)
  })

  it('an edit on one device reaches the other', async () => {
    const [a, b] = await syncedPair()
    await b.edit(N, 'from B')
    await settle()
    expect((await a.row(N))?.body).toBe('from B')
    await expectConverged(a, b)
  })

  it('conflicting edits: the first push wins the Note, the second becomes a Conflict copy with its fork point', async () => {
    const [a, b] = await syncedPair()
    server.failPushesWith = new Error('unavailable')
    await a.edit(N, 'A wrote this')
    await b.edit(N, 'B wrote this')
    await settle()
    server.failPushesWith = null
    a.engine.syncNow()
    await settle()
    b.engine.syncNow()
    await settle()

    expect(server.doc(UID, N)?.body).toBe('A wrote this')
    const copies = server.ids(UID).filter((id) => id !== N)
    expect(copies).toHaveLength(1)
    const copy = server.doc(UID, copies[0]!)!
    expect(copy).toMatchObject({ body: 'B wrote this', conflictOf: N, conflictBase: { title: 'T', titleIsCustom: true, body: 'zero' } })
    await expectConverged(a, b)
  })

  it('a delete racing an edit, edit first: the delete loses and nothing is resurrected or lost', async () => {
    const [a, b] = await syncedPair()
    server.failPushesWith = new Error('unavailable')
    await a.del(N)
    await b.edit(N, 'kept')
    await settle()
    server.failPushesWith = null
    b.engine.syncNow()
    await settle()
    a.engine.syncNow()
    await settle()

    expect(server.doc(UID, N)).toMatchObject({ body: 'kept', deletedAt: null })
    expect(server.ids(UID)).toEqual([N])
    await expectConverged(a, b)
  })

  it('a delete racing an edit, delete first: the Tombstone is not resurrected, the edit survives as a copy', async () => {
    const [a, b] = await syncedPair()
    server.failPushesWith = new Error('unavailable')
    await a.del(N)
    await b.edit(N, 'written against the live Note')
    await settle()
    server.failPushesWith = null
    a.engine.syncNow()
    await settle()
    b.engine.syncNow()
    await settle()

    expect(server.doc(UID, N)?.deletedAt).not.toBeNull()
    const copies = server.ids(UID).filter((id) => id !== N)
    expect(copies.map((id) => server.doc(UID, id))).toEqual([
      expect.objectContaining({ body: 'written against the live Note', deletedAt: null, conflictOf: N }),
    ])
    await expectConverged(a, b)
  })
})

describe('transaction interleaving', () => {
  it('commits the action of the attempt that committed, not of the attempt that was retried away', async () => {
    const [a, b] = await syncedPair()
    const held = gate()
    let attempts = 0
    server.beforeWrite = async ({ flight, attempt }) => {
      if (flight.noteId !== N || flight.deviceId !== 'devA') return
      attempts = attempt
      if (attempt === 1) await held.promise // B lands its edit between A's read and A's write
    }
    await a.edit(N, 'A')
    await settle()
    server.beforeWrite = null
    await b.edit(N, 'B')
    await settle()
    server.beforeWrite = async ({ attempt }) => void (attempts = attempt)
    held.open()
    await settle()

    expect(attempts).toBe(2)
    expect(server.doc(UID, N)?.body).toBe('B') // attempt 1 would have been a clean write of 'A'
    const copyIds = server.ids(UID).filter((id) => id !== N)
    expect(copyIds.map((id) => server.doc(UID, id)?.body)).toEqual(['A'])
    await expectConverged(a, b)
  })
})

describe('the adopt view (02 defect 1, as ruled by the mathematician 2026-09-17)', () => {
  it('a commit never reads lastServerState between a snapshot row write and its map update', async () => {
    const [a] = await syncedPair()
    const held = gate()
    server.beforeWrite = ({ flight }) => (flight.deviceId === 'devA' ? held.promise : undefined)
    await a.edit(N, 'same text')
    await settle()

    // The snapshot's store transaction commits, then stalls before the engine hears back —
    // IndexedDB's commit latency, stretched. A commit that slips in here sees a stale map.
    const original = a.store.runInTransaction.bind(a.store)
    const commitLatency = gate()
    let stall = true
    a.store.runInTransaction = async (fn) => {
      const result = await original(fn)
      if (stall) {
        stall = false
        await commitLatency.promise
      }
      return result
    }
    server.put(UID, N, serverDoc('r2', 'same text')) // delivered to A: dirty row, map := r2
    await settle()
    server.beforeWrite = null
    held.open() // A's push reads r2: a fast-forward, adopted from the map
    await settle()
    commitLatency.open()
    await settle()

    // Adopting the stale r0 here would leave A behind a snapshot that has already been delivered.
    expect(await a.row(N)).toEqual(cleanRow(N, serverDoc('r2', 'same text')))
  })

  it('once this session has applied a complete batch: adopts from lastServerState, not from the fresher transaction read', async () => {
    const [a] = await syncedPair()
    server.hold() // A's listener now lags
    server.put(UID, N, serverDoc('r2', 'same text', { updatedAt: 7 })) // another client
    await a.edit(N, 'same text') // identical content: a fast-forward
    await settle()

    // lastServerState still says r0 — the view the listener has delivered.
    expect(await a.row(N)).toEqual(cleanRow(N, serverDoc('r0', 'zero')))
    server.release()
    await settle()
    expect(await a.row(N)).toEqual(cleanRow(N, serverDoc('r2', 'same text', { updatedAt: 7 })))
  })

  it('before any complete batch this session: adopts from the transaction read', async () => {
    server.hold() // nothing is ever delivered to A in this test
    const a = await device('devA')
    await a.create(N, 'mine')
    await settle()
    expect(await a.row(N)).toMatchObject({ pendingRev: null, body: 'mine' })

    const landed = server.doc(UID, N)!
    server.put(UID, N, { ...landed, rev: asRev('r2'), body: 'same text' })
    await a.edit(N, 'same text')
    await settle()
    // lastServerState is empty; adopting from it would have deleted the row.
    expect(await a.row(N)).toEqual(cleanRow(N, { ...landed, rev: asRev('r2'), body: 'same text' }))
  })

  it('a persisted initialSyncCompletedAt does not make an empty session map authoritative (the restart hole)', async () => {
    server.put(UID, N, serverDoc('r0', 'zero'))
    server.hold()
    const a = await device('devA', { start: false })
    await a.store.setMeta('initialSyncCompletedAt', 1)
    await a.store.put(cleanRow(N, serverDoc('r0', 'zero')))
    server.put(UID, N, serverDoc('r2', 'same text'))
    await a.engine.start()
    await a.edit(N, 'same text')
    await settle()
    expect(await a.row(N)).toEqual(cleanRow(N, serverDoc('r2', 'same text')))
  })
})

describe('snapshot batches', () => {
  it('a complete batch deletes clean rows the server no longer has, and stamps initialSyncCompletedAt from the clock', async () => {
    const a = await device('devA', { start: false })
    await a.store.put(cleanRow(asNoteId('gone'), serverDoc('g0', 'purged elsewhere')))
    server.put(UID, N, serverDoc('r0', 'zero'))
    await a.engine.start()
    await settle()
    expect((await a.store.getAll()).map((r) => r.id)).toEqual([N])
    expect(await a.store.getMeta('initialSyncCompletedAt')).toBe(clock.now())
  })

  it('an empty from-cache batch at an offline open deletes nothing and stamps nothing', async () => {
    server.hold()
    const a = await device('devA', { start: false })
    await a.store.put(cleanRow(N, serverDoc('r0', 'zero')))
    await a.engine.start()
    server.emit(UID, { fromCache: true, complete: false, changes: [] })
    await settle()
    expect(await a.row(N)).toBeDefined()
    expect(await a.store.getMeta('initialSyncCompletedAt')).toBeUndefined()
  })

  it('a failed snapshot apply is surfaced and resubscribes after backoff, starting a new session', async () => {
    const a = await device('devA', { start: false })
    // A clean row that disagrees with the server at the same rev: applySnapshot refuses it.
    await a.store.put(cleanRow(N, serverDoc('r0', 'local disagrees')))
    server.put(UID, N, serverDoc('r0', 'zero'))
    await a.engine.start()
    await settle()
    expect(a.problems.map((p) => p.kind)).toEqual(['snapshot-failed'])
    expect(server.subscriptionsOpened).toBe(1)
    clock.advance(BACKOFF_MIN_MS)
    await settle()
    expect(server.subscriptionsOpened).toBe(2)
  })
  it('drops a batch still queued from a listener that a failed apply tore down', async () => {
    server.hold()
    const a = await device('devA', { start: false })
    await a.store.put(cleanRow(N, serverDoc('r0', 'local disagrees')))
    await a.engine.start()
    server.emit(UID, { fromCache: false, complete: true, changes: [{ id: N, doc: serverDoc('r0', 'zero') }] }) // fails
    server.emit(UID, { fromCache: false, complete: true, changes: [] }) // queued behind it, same listener
    await settle()
    expect(a.problems.map((p) => p.kind)).toEqual(['snapshot-failed'])
    expect(await a.row(N)).toBeDefined() // the stale batch would have deleted it as absent
    expect(await a.store.getMeta('initialSyncCompletedAt')).toBeUndefined()
  })
})

describe('the LocalNote leak guard — key sets of the objects handed to the transaction', () => {
  it('an ordinary Note carries exactly the seven wire keys', async () => {
    const a = await device('devA')
    await a.create(N, 'hello')
    await settle()
    const handed = server.handed.filter((h) => h.id === N)
    expect(handed).toHaveLength(1)
    expect(Object.keys(handed[0]!.doc).sort()).toEqual(WIRE_KEYS)
  })

  it('a fully populated Conflict copy carries exactly the nine, and its conflictBase exactly the three content keys', async () => {
    const [a, b] = await syncedPair()
    server.failPushesWith = new Error('unavailable')
    await a.edit(N, 'A')
    await b.edit(N, 'B')
    await settle()
    server.failPushesWith = null
    a.engine.syncNow()
    await settle()
    b.engine.syncNow()
    await settle()

    const copyId = server.ids(UID).find((id) => id !== N)!
    const writtenCopy = server.handed.filter((h) => h.id === copyId)
    expect(writtenCopy).toHaveLength(1)
    expect(Object.keys(writtenCopy[0]!.doc).sort()).toEqual(COPY_KEYS)
    expect(Object.keys(writtenCopy[0]!.doc.conflictBase!).sort()).toEqual(['body', 'title', 'titleIsCustom'])

    // And the copy pushed again as an ordinary row, once the user edits it.
    await b.edit(copyId, 'B, edited in the copy')
    await settle()
    const repushed = server.handed.filter((h) => h.id === copyId)
    expect(repushed).toHaveLength(2)
    expect(Object.keys(repushed[1]!.doc).sort()).toEqual(COPY_KEYS)
  })
})

describe('ConflictCopyIdTooLongError', () => {
  const LONG = asNoteId('n'.repeat(1490))

  it('is surfaced once per pending rev, the Note stays in the Outbox, and other Notes still push', async () => {
    const a = await device('devA')
    await a.create(LONG, 'deeply nested copy')
    await a.create(N, 'ordinary')
    await settle()

    expect(a.problems).toEqual([expect.objectContaining({ kind: 'conflict-copy-id-too-long', noteId: LONG })])
    expect(server.pushesStarted.get(LONG)).toBeUndefined()
    expect((await a.row(LONG))?.pendingRev).not.toBeNull()
    expect(server.doc(UID, N)?.body).toBe('ordinary')

    a.engine.wake()
    clock.advance(BACKOFF_MAX_MS)
    await settle()
    expect(a.problems).toHaveLength(1) // not retried, not re-surfaced

    await a.edit(LONG, 'edited again')
    await settle()
    expect(a.problems.filter((p) => p.kind === 'conflict-copy-id-too-long')).toHaveLength(2)
  })
})

describe('one in-flight push per Note', () => {
  it('wakes during a flight start no second push for that Note', async () => {
    const [a] = await syncedPair()
    const held = gate()
    server.beforeWrite = () => held.promise
    await a.edit(N, 'one')
    await settle()
    a.engine.wake()
    a.engine.syncNow()
    await a.edit(N, 'two')
    await settle()
    expect(server.pushesStarted.get(N)).toBe(1)

    server.beforeWrite = null
    held.open()
    await settle()
    // The typing during the flight is pushed next, and the row ends clean.
    expect(server.pushesStarted.get(N)).toBe(2)
    expect(server.doc(UID, N)?.body).toBe('two')
    expect(await a.row(N)).toMatchObject({ body: 'two', pendingRev: null })
  })

  it('different Notes push in parallel', async () => {
    const a = await device('devA')
    const held = gate()
    let inside = 0
    let most = 0
    server.beforeWrite = async () => {
      most = Math.max(most, ++inside)
      await held.promise
      inside--
    }
    await a.create(asNoteId('N1'), 'one')
    await a.create(asNoteId('N2'), 'two')
    await settle()
    expect(most).toBe(2)
    held.open()
    await settle()
    expect(server.ids(UID).sort()).toEqual(['N1', 'N2'])
  })
})

describe('backoff and wake sources', () => {
  it('backs off 1s doubling to a 60s cap on transient failures', async () => {
    const a = await device('devA')
    server.failPushesWith = new Error('unavailable')
    await a.create(N, 'x')
    await settle()
    const delays: number[] = []
    for (let i = 0; i < 9; i++) {
      const [next] = clock.pending()
      delays.push(next!)
      clock.advance(next!)
      await settle()
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000])
    expect(server.pushesStarted.get(N)).toBe(10)
    expect(BACKOFF_MIN_MS).toBe(1000)
    expect(BACKOFF_MAX_MS).toBe(60000)
  })

  it('a successful push resets the backoff', async () => {
    const a = await device('devA')
    server.hold() // no snapshot may do the resetting here
    server.failPushesWith = new Error('unavailable')
    await a.create(N, 'x')
    await settle()
    clock.advance(1000)
    await settle()
    clock.advance(2000)
    await settle()
    server.failPushesWith = null
    clock.advance(4000)
    await settle()
    expect(server.doc(UID, N)?.body).toBe('x')

    server.failPushesWith = new Error('unavailable')
    await a.edit(N, 'y')
    await settle()
    expect(clock.pending()).toEqual([1000])
  })

  it('a server-backed snapshot resets the backoff and wakes the Outbox at once', async () => {
    const a = await device('devA')
    await settle()
    server.failPushesWith = new Error('unavailable')
    await a.create(N, 'x')
    await settle()
    clock.advance(1000)
    await settle()
    expect(clock.pending()).toEqual([2000])

    server.failPushesWith = null
    server.put(UID, asNoteId('other'), serverDoc('o1', 'from elsewhere'))
    await settle()
    expect(server.doc(UID, N)?.body).toBe('x')
    expect(clock.pending()).toEqual([])
  })

  it('a from-cache snapshot neither resets the backoff nor wakes the Outbox', async () => {
    const a = await device('devA')
    await settle()
    server.failPushesWith = new Error('unavailable')
    await a.create(N, 'x')
    await settle()
    clock.advance(1000)
    await settle()
    const started = server.pushesStarted.get(N)
    server.failPushesWith = null
    server.emit(UID, { fromCache: true, complete: false, changes: [] })
    await settle()
    expect(server.pushesStarted.get(N)).toBe(started)
    expect(clock.pending()).toEqual([2000])
  })

  it('with Auto sync off, only Sync Now pushes', async () => {
    const a = await device('devA')
    a.autoSync = false
    await a.create(N, 'x')
    a.engine.wake()
    server.put(UID, asNoteId('other'), serverDoc('o1', 'snapshot wake'))
    clock.advance(BACKOFF_MAX_MS)
    await settle()
    expect(server.doc(UID, N)).toBeUndefined()

    a.engine.syncNow()
    await settle()
    expect(server.doc(UID, N)?.body).toBe('x')
  })

  it('with Auto sync off, a failed Sync Now is not retried by the backoff timer', async () => {
    const a = await device('devA')
    a.autoSync = false
    server.failPushesWith = new Error('unavailable')
    await a.create(N, 'x')
    a.engine.syncNow()
    await settle()
    expect(server.pushesStarted.get(N)).toBe(1)
    server.failPushesWith = null
    clock.advance(BACKOFF_MAX_MS)
    await settle()
    expect(server.pushesStarted.get(N)).toBe(1)
  })

  it('a permanent failure is surfaced and not retried until the Note changes', async () => {
    const a = await device('devA')
    server.failPushesWith = new PermanentPushError('permission-denied')
    await a.create(N, 'x')
    await settle()
    expect(a.problems).toEqual([expect.objectContaining({ kind: 'push-failed', noteId: N, permanent: true })])
    expect(clock.pending()).toEqual([])

    a.engine.syncNow()
    await settle()
    expect(server.pushesStarted.get(N)).toBe(1)

    server.failPushesWith = null
    await a.edit(N, 'y')
    await settle()
    expect(server.doc(UID, N)?.body).toBe('y')
  })

  it('a failure while writing the commit locally is a push failure, retried; the retry finds it landed', async () => {
    const a = await device('devA')
    server.hold() // only the commit's store transaction may hit the failure
    const original = a.store.runInTransaction.bind(a.store)
    let failOnce = true
    a.store.runInTransaction = (fn) => {
      if (failOnce && server.doc(UID, N) !== undefined) {
        failOnce = false
        return Promise.reject(new Error('QuotaExceededError'))
      }
      return original(fn)
    }
    await a.create(N, 'x')
    await settle()
    expect(a.problems.map((p) => p.kind)).toEqual(['push-failed'])
    clock.advance(1000)
    await settle()
    expect(await a.row(N)).toMatchObject({ pendingRev: null, body: 'x' })
  })
})

describe('the per-push timeout', () => {
  it('surfaces at 10s but keeps the Note gated until the push settles; a late success commits normally', async () => {
    const [a] = await syncedPair()
    const held = gate()
    server.beforeWrite = () => held.promise
    await a.edit(N, 'slow')
    await settle()

    clock.advance(PUSH_TIMEOUT_MS - 1)
    await settle()
    expect(a.problems).toEqual([])
    clock.advance(1)
    await settle()
    expect(a.problems).toEqual([{ kind: 'push-timeout', noteId: N }])

    a.engine.wake()
    a.engine.syncNow()
    await settle()
    expect(server.pushesStarted.get(N)).toBe(1) // still gated: no second flight from this device

    server.beforeWrite = null
    held.open()
    await settle()
    expect(await a.row(N)).toMatchObject({ body: 'slow', pendingRev: null })
    expect(server.pushesStarted.get(N)).toBe(1)
  })

  it('a late failure after a timeout counts towards backoff once, not twice', async () => {
    const [a] = await syncedPair()
    const held = gate()
    server.beforeWrite = () => held.promise
    await a.edit(N, 'slow')
    await settle()
    clock.advance(PUSH_TIMEOUT_MS)
    await settle()
    expect(clock.pending()).toEqual([])

    server.failPushesWith = new Error('deadline-exceeded')
    held.open()
    await settle()
    expect(clock.pending()).toEqual([BACKOFF_MIN_MS])
    clock.advance(BACKOFF_MIN_MS)
    await settle()
    expect(clock.pending()).toEqual([2 * BACKOFF_MIN_MS])
  })
})

describe('seeded random walks — two engines, one server, interleaved inside transactions', () => {
  // Edits APPEND a token, so a descendant's body starts with its ancestor's: "this content
  // survived" is a prefix check. Deletes toggle the Tombstone and may lose by design (02).
  const SEEDS = 400
  const STEPS = 40

  const mulberry32 = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  it.each(Array.from({ length: SEEDS }, (_, i) => i + 1))('seed %i converges and loses no typed content', async (seed) => {
    const rnd = mulberry32(seed)
    const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!
    const [a, b] = await syncedPair()
    const devs = [a, b]
    let created = 0
    let nested = false
    // P1, observed: every live content any device ever held, and every body ever on the server.
    // A tip may vanish only by surviving (a descendant on the server) or by becoming a
    // Tombstone first (a lost delete is dropped by design, 02). Recorded at the moment of each
    // act, not after a settle — a loss inside one settle must still be seen.
    const seenTips = new Map<string, Set<string>>() // `${device}/${id}` → live bodies
    const tombstoned = new Map<string, Set<string>>() // `${device}/${id}` → tombstone bodies
    const note = (into: Map<string, Set<string>>, key: string, body: string) => into.set(key, (into.get(key) ?? new Set()).add(body))
    const edit = async (d: Device, id: NoteId, body: string) => {
      note(seenTips, `${d.name}/${id}`, body)
      await d.edit(id, body)
    }
    const observe = async () => {
      for (const d of devs) {
        for (const r of await d.store.getAll()) note(r.deletedAt === null ? seenTips : tombstoned, `${d.name}/${r.id}`, r.body)
      }
    }

    server.beforeWrite = async () => {
      if (nested || rnd() > 0.2) return
      nested = true // another device acts between this transaction's read and its write
      const d = pick(devs)
      const rows = (await d.store.getAll()).filter((r) => r.deletedAt === null)
      if (rows.length > 0) {
        const r = pick(rows)
        await edit(d, r.id, `${r.body}|${d.name}${++revs}`)
      }
      await server.settle(2)
      nested = false
    }

    for (let step = 0; step < STEPS; step++) {
      const d = pick(devs)
      const roll = rnd()
      const rows = await d.store.getAll()
      const live = rows.filter((r) => r.deletedAt === null) // the editor does not edit in Trash
      if (roll < 0.45 && live.length > 0) {
        const r = pick(live)
        await edit(d, r.id, `${r.body}|${d.name}${++revs}`)
      } else if (roll < 0.55 && rows.length > 0) {
        const r = pick(rows)
        if (r.deletedAt === null) note(tombstoned, `${d.name}/${r.id}`, r.body)
        await d.del(r.id)
      } else if (roll < 0.6) {
        await d.create(asNoteId(`M${++created}`), `${d.name}-new${created}`)
      } else if (roll < 0.7) {
        server.failPushesWith = server.failPushesWith === null ? new Error('unavailable') : null
      } else if (roll < 0.8) {
        if (rnd() < 0.5) server.hold()
        else server.release()
      } else if (roll < 0.9) {
        d.engine.syncNow()
      } else {
        clock.advance(Math.floor(rnd() * 8_000))
      }
      await server.settle(1 + Math.floor(rnd() * 3))
      await observe()
    }

    server.failPushesWith = null
    server.beforeWrite = null
    server.release()
    for (let round = 0; round < 20; round++) {
      devs.forEach((d) => d.engine.syncNow())
      await settle()
      clock.advance(PUSH_TIMEOUT_MS)
      await settle()
      await observe()
      const dirty = (await Promise.all(devs.map((d) => d.store.getAll()))).flat().filter((r) => r.pendingRev !== null)
      if (dirty.length === 0) break
    }

    await expectConverged(a, b)
    const survivors = [...server.handed.map((h) => h.doc.body), ...server.ids(UID).map((id) => server.doc(UID, id)!.body)]
    for (const [key, bodies] of seenTips) {
      for (const tip of bodies) {
        const kept = survivors.some((body) => body.startsWith(tip)) || [...(tombstoned.get(key) ?? [])].some((t) => t.startsWith(tip))
        expect(kept, `content lost on ${key}: ${tip}`).toBe(true)
      }
    }
    expect(devs.flatMap((d) => d.problems).filter((p) => p.kind !== 'push-failed' && p.kind !== 'push-timeout')).toEqual([])
  })
})
