import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp } from 'firebase/app'
import type { FirebaseApp } from 'firebase/app'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import type { NoteDoc } from '../domain/note'
import { asRev } from '../domain/note'
import type { SnapshotBatch } from './remoteGateway'
import { createFirestoreGateway, openFirestore } from './firestoreGateway'

// Step 7's read-cost measurement, and **now the BASELINE, not the live cost** (ticket 03's
// 2026-10-03 amendment). It pins what a memory cache costs: no resume token survives the process,
// so every cold open re-reads the whole collection — N documents, per open, for ever. That is the
// number the amendment was argued against, and it is kept measured rather than remembered.
//
// It therefore pins `cache: 'memory'` explicitly. Do NOT read it as the shipped cost: production
// runs a persistent cache, where the complete batch still CARRIES N documents (so documents
// delivered stays N here) while Firestore bills only the delta for a reopen within ~30 minutes.
// Documents delivered stopped being a proxy for documents billed at that amendment, and the
// emulator cannot bill, so the live saving is checked on the Firebase usage graph instead.

const PROJECT = 'demo-notemaker'
const UID = 'u1'
const CORPUS = 500
const [HOST, PORT] = process.env['FIRESTORE_EMULATOR_HOST']!.split(':') as [string, string]

let env: RulesTestEnvironment
const apps: FirebaseApp[] = []
let seq = 0

const body = (i: number) => `Note ${i}\n` + 'A realistic paragraph of markdown text. '.repeat(50) // ~2 kB, 03's estimate

/** A fresh app instance: what a cold start after Android reaped the process looks like. */
function coldOpen() {
  const app = initializeApp({ projectId: PROJECT }, `read-cost-${++seq}`)
  apps.push(app)
  const gateway = createFirestoreGateway(
    openFirestore(app, { emulator: { host: HOST, port: Number(PORT), uid: UID }, cache: 'memory' }),
  )
  const batches: SnapshotBatch[] = []
  const unsubscribe = gateway.subscribeNotes(UID, (b) => batches.push(b), () => undefined)
  const delivered = () => batches.reduce((n, b) => n + b.changes.length, 0)
  return { batches, unsubscribe, delivered }
}

async function until(what: string, predicate: () => boolean, ms = 30_000): Promise<void> {
  const end = Date.now() + ms
  while (!predicate()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8') } })
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    for (let start = 0; start < CORPUS; start += 250) {
      const batch = db.batch()
      for (let i = start; i < Math.min(start + 250, CORPUS); i++) {
        const d: NoteDoc = { title: `Note ${i}`, titleIsCustom: false, body: body(i), createdAt: i, updatedAt: i, deletedAt: null, rev: asRev(`r${i}`) }
        batch.set(db.doc(`users/${UID}/notes/n${i}`), d)
      }
      await batch.commit()
    }
  })
}, 60_000)

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => deleteApp(a)))
})

afterAll(async () => {
  await env.cleanup()
})

describe(`BASELINE: read cost per cold open at ${CORPUS} Notes on a memory cache`, () => {
  it('a cold open receives every document exactly once: reads per open = corpus size', async () => {
    const open = coldOpen()
    await until('the complete batch', () => open.batches.some((b) => b.complete))
    await new Promise((r) => setTimeout(r, 1_500)) // anything else the listener would deliver
    const complete = open.batches.find((b) => b.complete)!
    expect(complete.changes).toHaveLength(CORPUS)
    expect(open.delivered()).toBe(CORPUS)
    console.info(`[read cost baseline] cold open at ${CORPUS} Notes: ${open.delivered()} documents delivered in ${open.batches.length} batch(es)`)
    open.unsubscribe()
  }, 60_000)

  it('every cold open pays it again — no resume token survives the process', async () => {
    const first = coldOpen()
    await until('first open complete', () => first.batches.some((b) => b.complete))
    first.unsubscribe()
    const second = coldOpen()
    await until('second open complete', () => second.batches.some((b) => b.complete))
    await new Promise((r) => setTimeout(r, 500))
    expect(second.delivered()).toBe(CORPUS)
    second.unsubscribe()
  }, 60_000)
})
