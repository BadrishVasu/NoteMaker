// @vitest-environment node
import 'fake-indexeddb/auto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp } from 'firebase/app'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { asNoteId, asRev } from '../domain/note'
import type { NoteDoc } from '../domain/note'
import type { SnapshotBatch } from './remoteGateway'
import { createFirestoreGateway, openFirestore } from './firestoreGateway'

// Ticket 03, amendment 2026-10-03 (mathematician + designer): the SDK cache is persistent, for its
// resume token only — it is never a read surface. The rule that makes that true is the gateway's:
// before this subscription's first server-backed snapshot, a from-cache delivery is emitted with
// NO changes. Under the old memory cache that batch was always empty, so the defect was latent;
// under a persistent cache it carries the SDK's own, possibly stale copy, and applying it walks
// clean mirror rows backwards (offline, permanently).
//
// This is the one test that can see it: two sessions over ONE warm persisted cache (fake-indexeddb
// keeps it for the process), with the server moved on in between. Remove the rule and the
// pre-complete batch carries the stale document.

const PROJECT = 'demo-notemaker'
const UID = 'u1'
const N = asNoteId('N')
const APP = 'persistent-cache-test' // the same app name twice = the same persisted cache

let env: RulesTestEnvironment

const doc = (rev: string, body: string): NoteDoc => ({
  title: 'T',
  titleIsCustom: true,
  body,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  rev: asRev(rev),
})

async function otherClientPut(d: NoteDoc): Promise<void> {
  await env.authenticatedContext(UID).firestore().doc(`users/${UID}/notes/${N}`).set(d)
}

const [HOST, PORT] = process.env['FIRESTORE_EMULATOR_HOST']!.split(':') as [string, string]

/** One app lifetime against the shared persisted cache: listen, collect, close. */
async function session(): Promise<SnapshotBatch[]> {
  const app = initializeApp({ projectId: PROJECT }, APP)
  const gateway = createFirestoreGateway(openFirestore(app, { emulator: { host: HOST, port: Number(PORT), uid: UID } }))
  const batches: SnapshotBatch[] = []
  const unsubscribe = gateway.subscribeNotes(UID, (b) => batches.push(b), () => undefined)
  const end = Date.now() + 20_000
  while (!batches.some((b) => b.complete)) {
    if (Date.now() > end) throw new Error('timed out waiting for a complete batch')
    await new Promise((r) => setTimeout(r, 20))
  }
  await new Promise((r) => setTimeout(r, 500)) // anything else the listener would deliver
  unsubscribe()
  await deleteApp(app)
  return batches
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8') } })
  await env.clearFirestore()
}, 60_000)

afterAll(async () => {
  await env.cleanup()
})

describe('the persistent SDK cache is a resume token, never a read surface', () => {
  it('a warm cache holding a stale document contributes nothing before the server-backed batch', async () => {
    await otherClientPut(doc('r1', 'version one'))
    const first = await session()
    expect(first.find((b) => b.complete)?.changes).toEqual([{ id: N, doc: doc('r1', 'version one') }])

    // The cache is actually ON DISK — without this the test passes under memoryLocalCache too,
    // where session two simply has nothing warm and the drop rule is never exercised. The resume
    // token this whole amendment exists for lives in that database.
    const persisted = (await indexedDB.databases()).map((d) => d.name ?? '')
    expect(persisted.some((name) => name.includes('firestore')), `no Firestore cache on disk: ${persisted.join(', ')}`).toBe(true)

    // The server moves on while this device is closed; its SDK cache still holds version one.
    await otherClientPut(doc('r2', 'version two'))

    const second = await session()
    const completeAt = second.findIndex((b) => b.complete)
    expect(completeAt).toBeGreaterThanOrEqual(0)
    // The rule: nothing before the complete batch carries content, however warm the cache is.
    for (const batch of second.slice(0, completeAt)) {
      expect(batch, 'a pre-complete batch carried the SDK cache (stale) content').toEqual({
        fromCache: true,
        complete: false,
        changes: [],
      })
    }
    // And the complete batch is the whole collection at the server's version, from snapshot.docs.
    expect(second[completeAt]).toEqual({
      fromCache: false,
      complete: true,
      changes: [{ id: N, doc: doc('r2', 'version two') }],
    })
  }, 90_000)
})
