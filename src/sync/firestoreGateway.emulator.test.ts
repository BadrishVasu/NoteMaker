import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp } from 'firebase/app'
import type { FirebaseApp } from 'firebase/app'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { asDeviceId, asNoteId, asRev } from '../domain/note'
import type { NoteDoc, NoteId } from '../domain/note'
import { newLocalNote } from '../domain/edit'
import { beginPush, decide } from '../domain/reconcile'
import type { Flight, PushAction, TransactionRead } from '../domain/reconcile'
import { PermanentPushError } from './remoteGateway'
import type { RemoteGateway, SnapshotBatch } from './remoteGateway'
import { createFirestoreGateway, mapPushError, openFirestore } from './firestoreGateway'
import { startTcpProxy } from '../test/tcpProxy'
import type { TcpProxy } from '../test/tcpProxy'
import type { FirestoreGatewayOptions, GatewayWriteContext } from './firestoreGateway'

// Step 5: the real gateway against the emulator. Scope is only what fakeGateway cannot model
// honestly — listener metadata, real transaction retry, real rules denials. Everything else
// about the engine is covered against the fake.

const PROJECT = 'demo-notemaker'
const UID = 'u1'
const N = asNoteId('N')

let env: RulesTestEnvironment
const apps: FirebaseApp[] = []
let appSeq = 0

const [EMULATOR_HOST, EMULATOR_PORT] = process.env['FIRESTORE_EMULATOR_HOST']!.split(':') as [string, string]
const proxies: TcpProxy[] = []

/** `via` routes this client through a proxy whose link the test can cut. */
function gatewayFor(uid: string, opts: FirestoreGatewayOptions = {}, via?: TcpProxy): RemoteGateway {
  const app = initializeApp({ projectId: PROJECT }, `gateway-test-${++appSeq}`)
  apps.push(app)
  const port = via?.port ?? Number(EMULATOR_PORT)
  return createFirestoreGateway(openFirestore(app, { emulator: { host: via ? '127.0.0.1' : EMULATOR_HOST, port, uid } }), opts)
}

async function proxy(): Promise<TcpProxy> {
  const p = await startTcpProxy(EMULATOR_HOST, Number(EMULATOR_PORT))
  proxies.push(p)
  return p
}

const doc = (rev: string, body: string, extra: Partial<NoteDoc> = {}): NoteDoc => ({
  title: 'T',
  titleIsCustom: true,
  body,
  createdAt: 1_000,
  updatedAt: 1_000,
  deletedAt: null,
  rev: asRev(rev),
  ...extra,
})

/** A write by some other client of the same user, outside the gateway under test. */
async function otherClientPut(id: string, d: NoteDoc): Promise<void> {
  await env.authenticatedContext(UID).firestore().doc(`users/${UID}/notes/${id}`).set(d)
}

async function otherClientDelete(id: string): Promise<void> {
  await env.authenticatedContext(UID).firestore().doc(`users/${UID}/notes/${id}`).delete()
}

async function serverDoc(id: string): Promise<NoteDoc | undefined> {
  let data: NoteDoc | undefined
  await env.withSecurityRulesDisabled(async (ctx) => {
    data = (await ctx.firestore().doc(`users/${UID}/notes/${id}`).get()).data() as NoteDoc | undefined
  })
  return data
}

async function waitFor(what: string, predicate: () => boolean, ms = 10_000): Promise<void> {
  const until = Date.now() + ms
  while (!predicate()) {
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function listen(gateway: RemoteGateway, uid = UID) {
  const batches: SnapshotBatch[] = []
  const errors: unknown[] = []
  const unsubscribe = gateway.subscribeNotes(uid, (b) => batches.push(b), (e) => errors.push(e))
  return { batches, errors, unsubscribe, completeAt: () => batches.findIndex((b) => b.complete) }
}

const flightFor = (id: NoteId, body: string, rev = 'devA0001'): Flight =>
  beginPush(newLocalNote(id, { title: 'T', titleIsCustom: true, body }, asRev(rev), 1_000), asDeviceId('devA'))

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8') } })
})

beforeEach(async () => {
  await env.clearFirestore()
})

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => deleteApp(app)))
  await Promise.all(proxies.splice(0).map((p) => p.close()))
})

afterAll(async () => {
  await env.cleanup()
})

describe('subscribeNotes (includeMetadataChanges: true)', () => {
  it('an account with no Notes still gets exactly one complete batch: server-backed and empty', async () => {
    const l = listen(gatewayFor(UID))
    await waitFor('a complete batch', () => l.completeAt() >= 0)
    const i = l.completeAt()
    expect(l.batches[i]).toEqual({ fromCache: false, complete: true, changes: [] })
    expect(l.batches.slice(0, i).every((b) => b.fromCache && !b.complete)).toBe(true)
    expect(l.batches.filter((b) => b.complete)).toHaveLength(1)
    expect(l.errors).toEqual([])
    l.unsubscribe()
  })

  it('an account with Notes gets them all, whole, in the one complete batch', async () => {
    await otherClientPut('a', doc('r1', 'one'))
    await otherClientPut('b', doc('r2', 'two', { conflictOf: asNoteId('a'), conflictBase: { title: 'T', titleIsCustom: true, body: '' } }))
    const l = listen(gatewayFor(UID))
    await waitFor('a complete batch', () => l.completeAt() >= 0)
    const complete = l.batches[l.completeAt()]!
    expect(complete.fromCache).toBe(false)
    expect([...complete.changes].sort((x, y) => x.id.localeCompare(y.id))).toEqual([
      { id: 'a', doc: doc('r1', 'one') },
      { id: 'b', doc: doc('r2', 'two', { conflictOf: asNoteId('a'), conflictBase: { title: 'T', titleIsCustom: true, body: '' } }) },
    ])
    expect(l.batches.filter((b) => b.complete)).toHaveLength(1)
    l.unsubscribe()
  })

  // Offline cases: the client reaches the emulator through a proxy the test cuts. These are the
  // cases the Mathematician's 2026-09-17 ruling is about — online at open, the SDK waits for the
  // server before its first snapshot, so the online tests above cannot tell these rules apart.
  const OFFLINE_MS = 60_000

  it('offline at open, no Notes: the empty from-cache batch is not complete; reconnecting delivers the one complete batch', async () => {
    const link = await proxy()
    link.down()
    const l = listen(gatewayFor(UID, {}, link))
    await waitFor('the offline from-cache batch', () => l.batches.length > 0, 30_000)
    expect(l.batches[0]).toEqual({ fromCache: true, complete: false, changes: [] })

    link.up()
    await waitFor('a complete batch after reconnecting', () => l.completeAt() >= 0, 45_000)
    expect(l.batches[l.completeAt()]).toEqual({ fromCache: false, complete: true, changes: [] })
    expect(l.batches.filter((b) => b.complete)).toHaveLength(1)
    l.unsubscribe()
  }, OFFLINE_MS)

  it('offline at open, with Notes: nothing is complete until the server is reached, then every Note arrives whole', async () => {
    await otherClientPut('a', doc('r1', 'one'))
    const link = await proxy()
    link.down()
    const l = listen(gatewayFor(UID, {}, link))
    await waitFor('the offline from-cache batch', () => l.batches.length > 0, 30_000)
    expect(l.batches.every((b) => b.fromCache && !b.complete)).toBe(true)

    link.up()
    await waitFor('a complete batch after reconnecting', () => l.completeAt() >= 0, 45_000)
    expect(l.batches[l.completeAt()]).toEqual({ fromCache: false, complete: true, changes: [{ id: 'a', doc: doc('r1', 'one') }] })
    l.unsubscribe()
  }, OFFLINE_MS)

  it('a listener that opens offline over a warm cache: the complete batch is the full snapshot, not the (empty) docChanges', async () => {
    // L1 is online and holds `a` in the cache. The link drops; L2 opens and is served `a` from
    // cache. On reconnect nothing about `a` changed, so docChanges is empty — the complete batch
    // must still carry `a`, or the receiver would treat it as gone.
    await otherClientPut('a', doc('r1', 'one'))
    const link = await proxy()
    const gateway = gatewayFor(UID, {}, link)
    const first = listen(gateway)
    await waitFor('L1 to complete', () => first.completeAt() >= 0)
    link.down()
    await waitFor('L1 to go from-cache', () => first.batches.at(-1)?.fromCache === true, 30_000)

    const second = listen(gateway)
    await waitFor('L2 to be served from cache', () => second.batches.length > 0, 30_000)
    expect(second.batches.every((b) => b.fromCache && !b.complete)).toBe(true)

    link.up()
    await waitFor('L2 to complete', () => second.completeAt() >= 0, 45_000)
    expect(second.batches[second.completeAt()]!.changes).toEqual([{ id: 'a', doc: doc('r1', 'one') }])
    first.unsubscribe()
    second.unsubscribe()
  }, OFFLINE_MS)

  it('after the complete batch, delivers changes only, with a removal as doc: null', async () => {
    await otherClientPut('a', doc('r1', 'one'))
    await otherClientPut('b', doc('r2', 'two'))
    const l = listen(gatewayFor(UID))
    await waitFor('a complete batch', () => l.completeAt() >= 0)
    const seen = l.batches.length

    await otherClientPut('a', doc('r3', 'one, edited'))
    await waitFor('the edit', () => l.batches.slice(seen).some((b) => b.changes.length > 0))
    const edit = l.batches.slice(seen).find((b) => b.changes.length > 0)!
    expect(edit).toEqual({ fromCache: false, complete: false, changes: [{ id: 'a', doc: doc('r3', 'one, edited') }] })

    const seen2 = l.batches.length
    await otherClientDelete('b')
    await waitFor('the removal', () => l.batches.slice(seen2).some((b) => b.changes.length > 0))
    expect(l.batches.slice(seen2).find((b) => b.changes.length > 0)).toEqual({ fromCache: false, complete: false, changes: [{ id: 'b', doc: null }] })
    expect(l.batches.filter((b) => b.complete)).toHaveLength(1)
    l.unsubscribe()
  })

  it("reports a listener on another user's Notes as an error, not as a batch", async () => {
    const l = listen(gatewayFor(UID), 'u2')
    await waitFor('the listener error', () => l.errors.length > 0)
    expect(l.batches.filter((b) => b.complete)).toEqual([])
  })
})

describe('runPush', () => {
  it('a clean create writes the flight doc and returns the action and the read', async () => {
    const flight = flightFor(N, 'hello')
    const result = await gatewayFor(UID).runPush(UID, flight, (read) => decide(flight, read))
    expect(result).toEqual({ action: { kind: 'write', branch: 'create', doc: flight.doc }, read: { note: null, copy: null } })
    expect(await serverDoc(N)).toEqual(flight.doc)
  })

  it('re-runs decide on real contention and returns the committed attempt, not the retried-away one', async () => {
    // Contention on a read of a MISSING document: attempt 1 reads N absent and decides to
    // create; another client creates N before the commit; Firestore must retry, and the retry
    // must see the other client's document.
    const flight = flightFor(N, 'mine')
    const attempts: TransactionRead[] = []
    const gateway = gatewayFor(UID, {
      beforeWrite: async (ctx: GatewayWriteContext) => {
        if (ctx.attempt === 1) await otherClientPut(N, doc('other1', 'theirs'))
      },
    })
    const result = await gateway.runPush(UID, flight, (read) => {
      attempts.push(read)
      return decide(flight, read)
    })

    expect(attempts.length).toBeGreaterThanOrEqual(2)
    expect(attempts[0]).toEqual({ note: null, copy: null })
    expect(result.read.note).toEqual(doc('other1', 'theirs'))
    expect(result.action.kind).toBe('conflictCopy')
    expect(await serverDoc(N)).toEqual(doc('other1', 'theirs'))
    const copyId = (result.action as Extract<PushAction, { kind: 'conflictCopy' }>).copyId
    expect(await serverDoc(copyId)).toMatchObject({ body: 'mine', conflictOf: N, rev: flight.flightRev })
  })

  it('without contention decide runs exactly once (control for the retry test)', async () => {
    const flight = flightFor(N, 'mine')
    let calls = 0
    await gatewayFor(UID, { beforeWrite: async () => undefined }).runPush(UID, flight, (read) => {
      calls++
      return decide(flight, read)
    })
    expect(calls).toBe(1)
  })

  it('a rules denial reaches the caller as PermanentPushError (a write the allowlist rejects)', async () => {
    const flight = flightFor(N, 'x')
    const bad: Flight = { ...flight, doc: { ...flight.doc, title: '' } } // passes assertWireDoc, fails the rules
    const error = await gatewayFor(UID)
      .runPush(UID, bad, (read) => decide(bad, read))
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PermanentPushError)
    expect((error as PermanentPushError).cause).toMatchObject({ code: 'permission-denied' })
    expect(await serverDoc(N)).toBeUndefined()
  })

  it("a rules denial on another user's path is permanent too", async () => {
    const flight = flightFor(N, 'x')
    const error = await gatewayFor(UID)
      .runPush('u2', flight, (read) => decide(flight, read))
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PermanentPushError)
  })

  it('assertWireDoc runs on the object handed to transaction.set: a leaked local field is refused and nothing is written', async () => {
    const flight = flightFor(N, 'x')
    const leaked = { ...flight.doc, baseContent: null } as unknown as NoteDoc
    const error = await gatewayFor(UID)
      .runPush(UID, flight, () => ({ kind: 'write', branch: 'create', doc: leaked }))
      .catch((e: unknown) => e)
    expect(String(error)).toMatch(/non-wire field\(s\): baseContent/)
    expect(await serverDoc(N)).toBeUndefined()
  })

  it('the same action without the leaked field lands (control for the leak test)', async () => {
    const flight = flightFor(N, 'x')
    await gatewayFor(UID).runPush(UID, flight, () => ({ kind: 'write', branch: 'create', doc: flight.doc }))
    expect(await serverDoc(N)).toEqual(flight.doc)
  })

  it('assertWireDoc guards the Conflict copy write too', async () => {
    await otherClientPut(N, doc('other1', 'theirs'))
    const flight = flightFor(N, 'x')
    const leakedCopy = { ...doc('devA0001', 'x', { conflictOf: N }), pendingRev: null } as unknown as NoteDoc
    const error = await gatewayFor(UID)
      .runPush(UID, flight, () => ({ kind: 'conflictCopy', copyId: flight.copyId, copy: leakedCopy }))
      .catch((e: unknown) => e)
    expect(String(error)).toMatch(/non-wire field\(s\): pendingRev/)
    expect(await serverDoc(flight.copyId)).toBeUndefined()
  })
})

describe('mapPushError', () => {
  const firestoreError = (code: string) => Object.assign(new Error(code), { name: 'FirebaseError', code })

  it.each(['permission-denied', 'invalid-argument', 'out-of-range', 'unimplemented'])('%s is permanent', (code) => {
    const mapped = mapPushError(firestoreError(code))
    expect(mapped).toBeInstanceOf(PermanentPushError)
    expect((mapped as PermanentPushError).cause).toMatchObject({ code })
  })

  it.each(['unavailable', 'aborted', 'failed-precondition', 'deadline-exceeded', 'resource-exhausted', 'unauthenticated', 'internal', 'unknown', 'cancelled'])(
    '%s stays transient, unchanged',
    (code) => {
      const e = firestoreError(code)
      expect(mapPushError(e)).toBe(e)
    },
  )

  it('a non-Firestore error passes through unchanged, even one carrying a permanent-looking code', () => {
    const e = Object.assign(new Error('x'), { code: 'permission-denied' })
    expect(mapPushError(e)).toBe(e)
  })
})
