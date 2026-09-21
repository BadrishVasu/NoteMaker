// @vitest-environment node
import { asDeviceId, asNoteId, asRev } from './domain/note'
import type { LocalNote, NoteDoc, NoteId } from './domain/note'
import { deleteMemoryNoteStore, openMemoryNoteStore } from './store/memoryNoteStore'
import type { NoteStore } from './store/noteStore'
import { FakeServer } from './sync/fakeGateway'
import { ManualClock } from './test/manualClock'
import { openSession } from './session'
import type { Session, SessionDeps } from './session'

// session.ts is the composition root (architecture.md, "Composition root", Designer 2026-09-21):
// it opens the per-uid mirror, loads the corpus, requests persist() without waiting on it, and
// wires the engine's committed writes and snapshot state into what the UI reads.

const UID = 'u1'
const N = asNoteId('N')

let server: FakeServer
let clock: ManualClock
let stores: NoteStore[]
const sessions: Session[] = []

const doc = (rev: string, body: string): NoteDoc => ({
  title: 'T',
  titleIsCustom: true,
  body,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  rev: asRev(rev),
})
const cleanRow = (id: NoteId, d: NoteDoc): LocalNote => ({ ...d, id, baseRev: d.rev, pendingRev: null, baseContent: null })

function deps(over: Partial<SessionDeps> = {}): SessionDeps {
  return {
    openStore: async (uid) => {
      const s = await openMemoryNoteStore(`notemaker-${uid}`)
      await s.setMeta('deviceId', asDeviceId('dev1'))
      stores.push(s)
      return s
    },
    gateway: server.gateway(),
    clock,
    autoSync: () => true,
    requestPersist: () => Promise.resolve(true),
    ...over,
  }
}

async function open(over: Partial<SessionDeps> = {}): Promise<Session> {
  const s = await openSession(UID, deps(over))
  sessions.push(s)
  await server.settle(10)
  return s
}

beforeEach(async () => {
  server = new FakeServer()
  clock = new ManualClock()
  stores = []
  await deleteMemoryNoteStore(`notemaker-${UID}`)
})

afterEach(async () => {
  for (const s of sessions.splice(0)) {
    clock.advance(60_000)
    await s.close().catch(() => undefined)
  }
})

describe('openSession', () => {
  it('opens the database named for the uid', async () => {
    const opened: string[] = []
    await open({ openStore: async (uid) => (opened.push(uid), deps().openStore(uid)) })
    expect(opened).toEqual([UID])
  })

  it('a returning device shows its mirror and its stamp at once — no loading state', async () => {
    const seeded = await openMemoryNoteStore(`notemaker-${UID}`)
    await seeded.put(cleanRow(N, doc('r0', 'mine')))
    await seeded.setMeta('initialSyncCompletedAt', 42)
    seeded.close()
    server.hold() // the server says nothing yet
    const s = await openSession(UID, deps())
    sessions.push(s)
    expect(s.corpus.getRow(N)?.body).toBe('mine')
    expect(s.status.getSnapshot()).toMatchObject({ initialSyncCompletedAt: 42, waitingForConnection: false })
  })

  it('a new device online: downloading until the complete batch lands, then its rows and the stamp', async () => {
    server.put(UID, N, doc('r0', 'from the server'))
    server.hold()
    const s = await openSession(UID, deps())
    sessions.push(s)
    expect(s.status.getSnapshot()).toMatchObject({ initialSyncCompletedAt: null, waitingForConnection: false })
    const seen: number[] = []
    s.status.subscribe(() => seen.push(1))
    clock.advance(7)
    server.release()
    await server.settle(10)
    expect(s.corpus.getRow(N)?.body).toBe('from the server')
    expect(s.status.getSnapshot()).toMatchObject({ initialSyncCompletedAt: clock.now(), waitingForConnection: false })
    expect(seen.length).toBeGreaterThan(0)
  })

  it('a new device offline: waiting for a connection on a from-cache batch, cleared by the complete one', async () => {
    server.hold()
    const s = await openSession(UID, deps())
    sessions.push(s)
    server.emit(UID, { fromCache: true, complete: false, changes: [] })
    await server.settle(10)
    expect(s.status.getSnapshot()).toMatchObject({ initialSyncCompletedAt: null, waitingForConnection: true })
    server.emit(UID, { fromCache: false, complete: true, changes: [] })
    await server.settle(10)
    expect(s.status.getSnapshot()).toMatchObject({ waitingForConnection: false, initialSyncCompletedAt: clock.now() })
  })

  it('a returning device opened offline is not "waiting for a connection" — its mirror is the list', async () => {
    const seeded = await openMemoryNoteStore(`notemaker-${UID}`)
    await seeded.setMeta('initialSyncCompletedAt', 42)
    seeded.close()
    server.hold()
    const s = await openSession(UID, deps())
    sessions.push(s)
    server.emit(UID, { fromCache: true, complete: false, changes: [] })
    await server.settle(10)
    expect(s.status.getSnapshot()).toMatchObject({ initialSyncCompletedAt: 42, waitingForConnection: false })
  })

  it('status snapshots are referentially stable between changes (useSyncExternalStore)', async () => {
    const s = await open()
    expect(s.status.getSnapshot()).toBe(s.status.getSnapshot())
  })

  it('local edits reach the server once woken', async () => {
    const s = await open()
    const store = stores[0]!
    const { newLocalNote } = await import('./domain/edit')
    const row = newLocalNote(N, { title: 'T', titleIsCustom: true, body: 'hi' }, asRev('p1'), 1)
    await store.put(row)
    s.corpus.applyWrites([{ op: 'put', row }])
    s.wake()
    await server.settle(10)
    expect(server.doc(UID, N)?.body).toBe('hi')
    expect(s.corpus.getRow(N)?.pendingRev).toBeNull() // the push commit reached the corpus
  })
})

describe('persist()', () => {
  it('is requested on first sign-in and its answer recorded, without holding up the open', async () => {
    let grant!: (v: boolean) => void
    const requestPersist = vi.fn(() => new Promise<boolean>((r) => (grant = r)))
    const s = await open({ requestPersist })
    expect(requestPersist).toHaveBeenCalledTimes(1)
    expect(s.status.getSnapshot().persistDenied).toBe(false) // unknown is not denied
    grant(false)
    await server.settle(5)
    expect(await stores[0]!.getMeta('persistGranted')).toBe(false)
    expect(s.status.getSnapshot().persistDenied).toBe(true)
  })

  it('is retried once per open while denied, and shown as denied until granted', async () => {
    const first = await openMemoryNoteStore(`notemaker-${UID}`)
    await first.setMeta('persistGranted', false)
    first.close()
    let grant!: (v: boolean) => void
    const requestPersist = vi.fn(() => new Promise<boolean>((r) => (grant = r)))
    const s = await openSession(UID, deps({ requestPersist }))
    sessions.push(s)
    expect(s.status.getSnapshot().persistDenied).toBe(true)
    grant(true)
    await server.settle(5)
    expect(requestPersist).toHaveBeenCalledTimes(1)
    expect(await stores[0]!.getMeta('persistGranted')).toBe(true)
    expect(s.status.getSnapshot().persistDenied).toBe(false)
  })

  it('is not asked again once granted', async () => {
    const first = await openMemoryNoteStore(`notemaker-${UID}`)
    await first.setMeta('persistGranted', true)
    first.close()
    const requestPersist = vi.fn(() => Promise.resolve(true))
    await open({ requestPersist })
    expect(requestPersist).not.toHaveBeenCalled()
  })
})

describe('close()', () => {
  it('stops the engine, waits for the in-flight push to commit, then closes the store', async () => {
    const s = await open()
    const store = stores[0]!
    const closeSpy = vi.spyOn(store, 'close')
    let release!: () => void
    server.beforeWrite = () => new Promise<void>((r) => (release = r))
    const { newLocalNote } = await import('./domain/edit')
    const row = newLocalNote(N, { title: 'T', titleIsCustom: true, body: 'last words' }, asRev('p1'), 1)
    await store.put(row)
    s.wake()
    await server.settle(10)
    const closing = s.close()
    await server.settle(10)
    expect(closeSpy).not.toHaveBeenCalled()
    server.beforeWrite = null
    release()
    await closing
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(server.doc(UID, N)?.body).toBe('last words')
    sessions.splice(0)
  })

  it('stops listening: nothing the server does afterwards reaches the corpus', async () => {
    const s = await open()
    await s.close()
    sessions.splice(0)
    server.put(UID, N, doc('r9', 'after sign-out'))
    await server.settle(10)
    expect(s.corpus.getRow(N)).toBeUndefined()
  })
})

describe('close() twice', () => {
  it('is one close: the store is closed once and both callers wait for it', async () => {
    const s = await open()
    const closeSpy = vi.spyOn(stores[0]!, 'close')
    await Promise.all([s.close(), s.close()])
    expect(closeSpy).toHaveBeenCalledTimes(1)
    sessions.splice(0)
  })
})
