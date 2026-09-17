import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp } from 'firebase/app'
import type { FirebaseApp } from 'firebase/app'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { asDeviceId, asNoteId, asRev, forkPointOf } from '../domain/note'
import type { LocalNote, NoteDoc, NoteId } from '../domain/note'
import { newLocalNote, recordEdit } from '../domain/edit'
import { deleteMemoryNoteStore, openMemoryNoteStore } from '../store/memoryNoteStore'
import type { NoteStore } from '../store/noteStore'
import { ManualClock } from '../test/manualClock'
import { createSyncEngine } from './engine'
import type { SyncEngine, SyncProblem } from './engine'
import { createFirestoreGateway, openFirestore } from './firestoreGateway'

// The port holds with the real implementation behind it: sync/engine.ts, unchanged, driving
// firestoreGateway against the emulator. Two devices = two Firebase apps signed in as the same
// user, each with its own memory store. The full engine matrix runs against fakeGateway; these
// are ticket 09's clean sync and conflicting edits, end to end.

const PROJECT = 'demo-notemaker'
const UID = 'u1'
const N = asNoteId('N')

let env: RulesTestEnvironment
let clock: ManualClock
let revs = 0
let seq = 0
const opened: { name: string; engine: SyncEngine; app: FirebaseApp }[] = []

interface Device {
  name: string
  store: NoteStore
  engine: SyncEngine
  problems: SyncProblem[]
  autoSync: boolean
  create(id: NoteId, body: string): Promise<void>
  edit(id: NoteId, body: string): Promise<void>
}

async function device(name: string): Promise<Device> {
  await deleteMemoryNoteStore(name)
  const store = await openMemoryNoteStore(name)
  await store.setMeta('deviceId', asDeviceId(name))
  const [host, port] = process.env['FIRESTORE_EMULATOR_HOST']!.split(':')
  const app = initializeApp({ projectId: PROJECT }, `engine-test-${++seq}`)
  const gateway = createFirestoreGateway(openFirestore(app, { emulator: { host: host!, port: Number(port), uid: UID } }))
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
  }
  dev.engine = createSyncEngine({ uid: UID, store, gateway, clock, autoSync: () => dev.autoSync, onProblem: (p) => dev.problems.push(p) })
  opened.push({ name, engine: dev.engine, app })
  await dev.engine.start()
  return dev
}

async function serverDocs(): Promise<Map<string, NoteDoc>> {
  const docs = new Map<string, NoteDoc>()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await ctx.firestore().collection(`users/${UID}/notes`).get()
    for (const d of snap.docs) docs.set(d.id, d.data() as NoteDoc)
  })
  return docs
}

async function eventually(what: string, check: () => Promise<boolean>, ms = 15_000): Promise<void> {
  const until = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

const cleanRow = (id: string, d: NoteDoc): LocalNote => ({ ...d, id: asNoteId(id), baseRev: d.rev, pendingRev: null, baseContent: null })

async function mirrorsEqualServer(...devices: Device[]): Promise<boolean> {
  const server = await serverDocs()
  const expected = [...server].map(([id, d]) => cleanRow(id, d)).sort((a, b) => a.id.localeCompare(b.id))
  for (const d of devices) {
    const rows = (await d.store.getAll()).sort((a, b) => a.id.localeCompare(b.id))
    if (!isDeepStrictEqual(rows, expected)) return false
  }
  return true
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8') } })
})

beforeEach(async () => {
  await env.clearFirestore()
  clock = new ManualClock()
  revs = 0
})

afterEach(async () => {
  for (const d of opened.splice(0)) {
    d.engine.stop()
    await deleteApp(d.app)
    await deleteMemoryNoteStore(d.name)
  }
})

afterAll(async () => {
  await env.cleanup()
})

describe('sync/engine.ts against firestoreGateway on the emulator', () => {
  it('clean sync: a Note created on one device lands on the server and on the other device', async () => {
    const a = await device('devA')
    const b = await device('devB')
    await a.create(N, 'hello from A')

    await eventually('B to hold the Note', async () => (await b.store.get(N))?.body === 'hello from A')
    await eventually('both mirrors to equal the server', () => mirrorsEqualServer(a, b))
    const server = await serverDocs()
    expect([...server.keys()]).toEqual([N])
    expect(server.get(N)).toMatchObject({ body: 'hello from A', rev: 'devA1', deletedAt: null })
    expect(Object.keys(server.get(N)!).sort()).toEqual(['body', 'createdAt', 'deletedAt', 'rev', 'title', 'titleIsCustom', 'updatedAt'])
    expect(a.problems).toEqual([])
    expect(b.problems).toEqual([])
  })

  it('conflicting edits: the first push wins the Note, the second becomes a Conflict copy with its fork point', async () => {
    const a = await device('devA')
    const b = await device('devB')
    await a.create(N, 'zero')
    await eventually('both to hold N clean', () => mirrorsEqualServer(a, b).then(async (ok) => ok && (await b.store.get(N)) !== undefined))

    a.autoSync = false
    b.autoSync = false
    await a.edit(N, 'A wrote this')
    await b.edit(N, 'B wrote this')

    a.engine.syncNow()
    await eventually('A to win N', async () => (await serverDocs()).get(N)?.body === 'A wrote this')
    b.engine.syncNow()
    await eventually('the copy', async () => (await serverDocs()).size === 2)
    await eventually('both mirrors to equal the server', () => mirrorsEqualServer(a, b))

    const server = await serverDocs()
    expect(server.get(N)?.body).toBe('A wrote this')
    const [copyId, copy] = [...server].find(([id]) => id !== N)!
    expect(copy).toMatchObject({ body: 'B wrote this', conflictOf: N, conflictBase: { title: 'T', titleIsCustom: true, body: 'zero' } })
    expect(Object.keys(copy).sort()).toEqual(['body', 'conflictBase', 'conflictOf', 'createdAt', 'deletedAt', 'rev', 'title', 'titleIsCustom', 'updatedAt'])
    expect((await b.store.get(asNoteId(copyId)))?.body).toBe('B wrote this')
    expect(a.problems).toEqual([])
    expect(b.problems).toEqual([])
  })

  it('a rules denial reaches the engine as a permanent failure', async () => {
    const a = await device('devA')
    // A create whose updatedAt is days ahead of the server: valid wire shape, denied by the rules.
    await a.store.put(newLocalNote(N, { title: 'T', titleIsCustom: true, body: 'from the future' }, asRev('devA9'), Date.now() + 3 * 86_400_000))
    a.engine.wake()
    await eventually('the push to fail', async () => a.problems.some((p) => p.kind === 'push-failed'))
    expect(a.problems).toContainEqual(expect.objectContaining({ kind: 'push-failed', noteId: N, permanent: true }))
    expect((await serverDocs()).size).toBe(0)
  })
})
