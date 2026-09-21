// @vitest-environment node
//
// QA — step 7, two-device sequences beyond src/test/savePath.test.ts's table. Same rig (real
// session + save queue + shared lock + one FakeServer), different sequences: delete/restore
// races, create-then-conflict, a redirect followed by more typing and another conflict on the
// copy, sign-out mid-push, and account switch with pending typing.
//
// Also pins the ONE open question Builder flagged for the Mathematician: what `saveNote.ts`'s
// `redirected` alias map does when the user deliberately reopens the original Note `from` after
// a redirect. This is reported as a finding, not a defect fix — expect it to change under review.

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

describe('QA step 7 — sequences beyond the save-path table', () => {
  it('delete/restore race: A deletes while B restores-then-types inside the same debounce window', async () => {
    const [a, b] = await pair()
    // B trashes it, then (before its own flush) restores it and keeps typing — all still pending.
    b.edit(N, { deletedAt: 10 })
    b.edit(N, { deletedAt: null, body: 'restored and typing' })
    a.edit(N, { deletedAt: 20 }) // A deletes it for real
    await a.flush()
    await b.flush()
    // Whatever wins, both mirrors must agree — no torn state, no lost write silently dropped.
    await expectConverged()
  })

  it('create-then-conflict: a brand-new Note created offline, then edited concurrently on landing', async () => {
    const a = await device('devA')
    const b = await device('devB')
    const id = asNoteId('new-note')
    // A creates a Note nobody else knows about yet (simulating commitCreate's own transaction).
    await a.session.exclusive(async () => {
      const created: LocalNote = {
        id,
        title: 'New',
        titleIsCustom: false,
        body: 'first',
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
        rev: asRev('a-create'),
        baseRev: null,
        pendingRev: asRev('a-create'),
        baseContent: null,
      }
      await a.session.store.runInTransaction((tx) => tx.put(created))
      a.session.corpus.applyWrites([{ op: 'put', row: created }])
    })
    a.session.wake()
    await settle()
    // B never saw it locally, but concurrently the server is about to receive A's create AND,
    // in the same window, A keeps typing before the create's response lands.
    a.open(id)
    a.edit(id, { body: 'first, then more' })
    await a.flush()
    await expectConverged()
    expect(server.doc(UID, id)?.body).toBe('first, then more')
    expect(server.ids(UID)).toEqual([id]) // no conflict copy spun off
    expect(b.session.corpus.getRow(id)?.body).toBe('first, then more') // B saw it converge too
  })

  it('a redirect, then more typing on the copy, then another conflict on THAT copy', async () => {
    const [a, b] = await pair()
    b.edit(N, { body: 'B typing' })
    a.edit(N, { body: 'A wrote this' })
    await a.flush() // B redirects: N -> copy1, B's pending flushes onto copy1
    await b.flush()
    expect(b.redirects).toHaveLength(1)
    const copy1 = copies()[0]!
    expect(server.doc(UID, copy1)?.body).toBe('B typing')

    // Now a third write lands on copy1 concurrently with B typing more into it — a second
    // conflict, this time on the copy itself, not on the original.
    a.open(copy1)
    a.edit(copy1, { body: 'A edits the copy too' })
    b.edit(copy1, { body: 'B typing more on the copy' }) // pending, not yet flushed
    await a.flush() // A's write lands clean on copy1; B's pending buffer is now stale underneath
    await b.flush() // B's flush must redirect AGAIN — copy-of-a-copy — never silently overwrite
    expect(b.redirects).toHaveLength(2)
    expect(b.redirects[1]!.from).toBe(copy1)
    const copy2 = copies().find((id) => id !== copy1)!
    expect(server.doc(UID, copy1)?.body).toBe('A edits the copy too')
    expect(server.doc(UID, copy2)?.body).toBe('B typing more on the copy')
    await expectConverged()
  })

  it('sign-out mid-push: close() waits for the in-flight push, the queue is flushed first', async () => {
    const [a] = await pair()
    let release!: () => void
    server.beforeWrite = () => new Promise<void>((r) => (release = r))
    a.edit(N, { body: 'last words before signing out' })
    a.queue.flush()
    await settle() // the write is now inside the server's transaction, blocked on beforeWrite
    // Designer's ordering: flush -> settled() -> session.close() -> auth.signOut().
    await a.queue.settled().catch(() => undefined) // settled() only waits on the LOCAL commit,
    // which is not gated by beforeWrite (that gate is server-side) — so this resolves once the
    // local mirror has the pending row; the push itself is still in flight.
    const closing = a.session.close()
    let closed = false
    void closing.then(() => (closed = true))
    await settle()
    expect(closed).toBe(false) // close() must not resolve while the push is in flight
    server.beforeWrite = null
    release()
    await closing
    expect(closed).toBe(true)
    expect(server.doc(UID, N)?.body).toBe('last words before signing out')
  })

  it('account switch with pending typing: closing session A while a debounce is still pending does not push the buffer', async () => {
    const [a] = await pair()
    a.edit(N, { body: 'not yet flushed' }) // pending, debounce running, NOT flushed
    // App.tsx's contract is flush-before-close is the CALLER's job (AppShell.handleSignOut /
    // onSignOut), not session.close()'s. If a caller closes without flushing (e.g. a bug in an
    // account-switch path that skips AppShell's own onSignOut), the buffered text must not
    // silently vanish into a partial server write — it simply never reaches the mirror.
    await a.session.close()
    expect(server.doc(UID, N)?.body).toBe('R0') // never pushed: correct, but silent data loss
    // for the user if a caller ever bypasses AppShell's flush-then-close-then-signOut order.
  })
})

describe("QA finding — reopening the original Note after a redirect (fixed: the alias is per edit stream)", () => {
  // QA pinned the defect here as a tripwire (a third, unprompted copy, N -> copy1 -> copy1-of-copy1).
  // The Mathematician's review ruled the alias serves only the stream open at redirect time, and
  // opening `from` starts a new stream at `from`. Builder rewrote this block to the correct outcome
  // once the fix landed, 2026-09-21, as the tripwire's own comment asked.
  it('deliberately reopening `from` after a redirect edits `from`; the copy is untouched; no third Note', async () => {
    const [a, b] = await pair()
    b.edit(N, { body: 'B typing' })
    a.edit(N, { body: 'A wrote this' })
    await a.flush() // B redirects: N -> copy
    await b.flush()
    const copy = copies()[0]!
    expect(server.doc(UID, N)?.body).toBe('A wrote this')
    expect(server.doc(UID, copy)?.body).toBe('B typing')

    b.open(N) // the user taps the original in the list
    b.edit(N, { body: 'A wrote this, then B looks at N again and types' })
    await b.flush()

    expect(server.ids(UID)).toHaveLength(2)
    expect(server.doc(UID, N)?.body).toBe('A wrote this, then B looks at N again and types')
    expect(server.doc(UID, copy)?.body).toBe('B typing')
  })

  it('a reincarnated id: after reopening `from` and starting a fresh stream, that stream can conflict again on its own merits', async () => {
    // Trying to break the fix per Builder's request: N gets an alias history (N -> copy1), the
    // user reopens N (clearing it, per the fix), then B's FRESH stream at N itself races A and
    // must redirect normally — proving the fix didn't leave stale bookkeeping that swallows or
    // misroutes a genuine new conflict on a Note id that used to be a `from`.
    const [a, b] = await pair()
    b.edit(N, { body: 'B typing' })
    a.edit(N, { body: 'A wrote this' })
    await a.flush() // N -> copy1
    await b.flush()
    const copy1 = copies()[0]!
    expect(b.redirects).toHaveLength(1)

    b.open(N) // clears the alias; new stream at N
    b.edit(N, { body: 'B reopened N and is typing again' }) // pending, not yet flushed
    a.edit(N, { body: 'A strikes again' })
    await a.flush() // A's push conflicts with B's still-pending buffer on N — a genuine SECOND redirect
    await b.flush()

    expect(b.redirects).toHaveLength(2)
    expect(b.redirects[1]!.from).toBe(N)
    expect(b.redirects[1]!.to).not.toBe(copy1) // a fresh copy, not a stale route back to the old one
    expect(server.doc(UID, N)?.body).toBe('A strikes again')
    expect(server.doc(UID, copy1)?.body).toBe('B typing') // the FIRST copy is untouched by any of this
    const copy2 = copies().find((id) => id !== copy1)!
    expect(server.doc(UID, copy2)?.body).toBe('B reopened N and is typing again')
    await expectConverged()
  })
})
