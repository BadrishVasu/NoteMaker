// @vitest-environment node
// 02, amendment 2026-09-21 (mathematician) — the editor buffer is a dirty row — pinned end to end:
// two devices, each a real session (store + corpus + engine + shared lock) with the real save
// queue on top, one FakeServer. Each case is a row of the Mathematician's table and names the
// mutant that turns it red. Every case ends converged: both mirrors equal the server, nothing dirty.

import { asDeviceId, asNoteId, asRev } from '../domain/note'
import type { LocalNote, NoteDoc, NoteId } from '../domain/note'
import { deleteMemoryNoteStore, openMemoryNoteStore } from '../store/memoryNoteStore'
import { FakeServer } from '../sync/fakeGateway'
import { createSaveQueue } from '../app/saveNote'
import type { EditPatch, SaveQueue } from '../app/saveNote'
import { openSession } from '../session'
import type { Session } from '../session'
import { ManualClock } from './manualClock'

const UID = 'u1'
const N = asNoteId('N')

let server: FakeServer
let clock: ManualClock
let revs = 0
const devices: Device[] = []

interface Device {
  name: string
  session: Session
  queue: SaveQueue
  redirects: { from: NoteId; to: NoteId }[]
  /** The editor mounts on `id`: seed from the row the corpus shows. */
  open(id: NoteId): void
  edit(id: NoteId, change: Partial<EditPatch>): void
  flush(): Promise<void>
}

const settle = () => server.settle(12)

async function device(name: string): Promise<Device> {
  await deleteMemoryNoteStore(`${name}-${UID}`)
  const session = await openSession(UID, {
    openStore: async () => {
      const s = await openMemoryNoteStore(`${name}-${UID}`)
      await s.setMeta('deviceId', asDeviceId(name))
      return s
    },
    gateway: server.gateway(),
    clock,
    autoSync: () => true,
    requestPersist: () => Promise.resolve(true),
  })
  const queue = createSaveQueue({
    store: session.store,
    corpus: session.corpus,
    exclusive: session.exclusive,
    mintRev: () => asRev(`${name}${++revs}`),
    now: () => ++revs,
    onCommitted: () => session.wake(),
  })
  const dev: Device = {
    name,
    session,
    queue,
    redirects: [],
    open: (id) => queue.seed(session.corpus.getRow(id)!),
    edit: (id, change) => queue.schedule(id, change),
    async flush() {
      queue.flush()
      await queue.settled()
      await settle()
    },
  }
  session.corpus.subscribeRedirect((r) => dev.redirects.push(r))
  devices.push(dev)
  await settle()
  return dev
}

const doc = (rev: string, body: string): NoteDoc => ({
  title: 'T',
  titleIsCustom: true,
  body,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  rev: asRev(rev),
})

/** A and B both hold N clean at R0; B's editor is open on it. */
async function pair(): Promise<[Device, Device]> {
  server.put(UID, N, doc('R0', 'R0'))
  const a = await device('devA')
  const b = await device('devB')
  a.open(N)
  b.open(N)
  return [a, b]
}

const copies = () => server.ids(UID).filter((id) => id !== N)

async function expectConverged(): Promise<void> {
  await settle()
  const expected = server
    .ids(UID)
    .map((id): LocalNote => ({ ...server.doc(UID, id)!, id, baseRev: server.doc(UID, id)!.rev, pendingRev: null, baseContent: null }))
    .sort((x, y) => x.id.localeCompare(y.id))
  for (const d of devices) {
    const rows = (await d.session.store.getAll()).sort((x, y) => x.id.localeCompare(y.id))
    expect(rows, `${d.name} mirror`).toEqual(expected)
    expect([...d.session.corpus.getRows().values()].sort((x, y) => x.id.localeCompare(y.id)), `${d.name} corpus`).toEqual(expected)
  }
}

beforeEach(() => {
  server = new FakeServer()
  clock = new ManualClock()
  revs = 0
})

afterEach(async () => {
  for (const d of devices.splice(0)) {
    d.queue.dispose()
    clock.advance(60_000)
    await d.session.close()
    await deleteMemoryNoteStore(`${d.name}-${UID}`)
  }
})

describe('the editor buffer is a dirty row — push outcomes end to end', () => {
  it('1. a remote edit lands during the debounce: ours becomes a copy, theirs survives (mutant: always-ordinary)', async () => {
    const [a, b] = await pair()
    b.edit(N, { body: 'R0 + B typing' }) // pending, not flushed
    a.edit(N, { body: 'A wrote this' })
    await a.flush() // A pushes; B adopts it underneath the pending buffer
    await b.flush()
    expect(server.doc(UID, N)?.body).toBe('A wrote this')
    expect(copies().map((id) => server.doc(UID, id)?.body)).toEqual(['R0 + B typing'])
    expect(b.redirects).toEqual([{ from: N, to: copies()[0] }])
    await expectConverged()
  })

  it('2. continuous typing across our own clean push: the next flush after a remote edit is a copy (mutant: always-ordinary)', async () => {
    const [a, b] = await pair()
    b.edit(N, { body: 'T1' })
    await b.flush() // T1 pushed clean; A adopts it
    a.open(N)
    a.edit(N, { body: 'T1, then A' })
    await a.flush()
    b.edit(N, { body: 'T1, then B' }) // B never re-seeded: its buffer derives from T1
    await b.flush()
    expect(server.doc(UID, N)?.body).toBe('T1, then A')
    expect(copies().map((id) => server.doc(UID, id)?.body)).toEqual(['T1, then B'])
    await expectConverged()
  })

  it('3. an idle editor adopted underneath: the whole-body keystroke becomes a copy (mutant: merge onto corpus row)', async () => {
    const [a, b] = await pair()
    a.edit(N, { body: 'A wrote this' })
    await a.flush()
    expect(b.session.corpus.getRow(N)?.body).toBe('A wrote this') // adopted, editor still shows R0
    b.edit(N, { body: 'R0!' })
    await b.flush()
    expect(server.doc(UID, N)?.body).toBe('A wrote this')
    expect(copies().map((id) => server.doc(UID, id)?.body)).toEqual(['R0!'])
    await expectConverged()
  })

  it('7. a fast-forward adopt (same content, new rev) then typing: a clean push, no copy (mutant: test by rev)', async () => {
    const [a, b] = await pair()
    a.edit(N, { body: 'detour' })
    await a.flush()
    a.edit(N, { body: 'R0' }) // back to what B's editor shows
    await a.flush()
    b.edit(N, { body: 'R0 + B' })
    await b.flush()
    expect(server.doc(UID, N)?.body).toBe('R0 + B')
    expect(copies()).toEqual([])
    await expectConverged()
  })

  it('8. a remote edit adopted, then Delete: the delete loses, their edit stays live (mutant: always-ordinary)', async () => {
    const [a, b] = await pair()
    a.edit(N, { body: 'A wrote this' })
    await a.flush()
    b.edit(N, { deletedAt: 99 })
    await b.flush()
    expect(server.doc(UID, N)).toMatchObject({ body: 'A wrote this', deletedAt: null })
    expect(copies()).toEqual([])
    await expectConverged()
  })

  it('9. a remote trash during the debounce: our text is a copy, the tombstone is not undone (mutant: always-ordinary)', async () => {
    const [a, b] = await pair()
    b.edit(N, { body: 'R0 + B typing' })
    a.edit(N, { deletedAt: 50 })
    await a.flush()
    await b.flush()
    expect(server.doc(UID, N)?.deletedAt).toBe(50)
    expect(copies().map((id) => server.doc(UID, id)?.body)).toEqual(['R0 + B typing'])
    await expectConverged()
  })

  it('5. a redirect while a debounce is pending: the flush goes to the copy as an ordinary edit, exactly one copy (mutant: no re-key)', async () => {
    const [a, b] = await pair()
    server.failPushesWith = new Error('unavailable')
    b.edit(N, { body: 'P1' })
    await b.flush() // committed locally, push failing
    server.failPushesWith = null
    b.edit(N, { body: 'P1 and more' }) // pending while the redirect lands
    a.edit(N, { body: 'A wrote this' })
    await a.flush() // B wakes on A's snapshot, pushes P1, loses, redirects
    expect(b.redirects).toHaveLength(1)
    await b.flush()
    expect(server.doc(UID, N)?.body).toBe('A wrote this')
    expect(copies().map((id) => server.doc(UID, id)?.body)).toEqual(['P1 and more'])
    await expectConverged()
  })
})
