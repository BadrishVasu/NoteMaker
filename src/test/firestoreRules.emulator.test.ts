import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'

// Ticket 01's security rules, both halves: ownership, and the closed nine-field allowlist of the
// 2026-08-26 amendment. Every allow case sits next to a deny case that differs from it in one
// thing, so a rule that allows everything and a rule that denies everything both turn this red.
//
// No firebase/firestore import (the import boundary): the compat handle from
// `context.firestore()` is enough to write adversarial documents.

const PROJECT = 'demo-notemaker'
const PATH = 'users/u1/notes/n1'
const DAY_MS = 86_400_000

let env: RulesTestEnvironment

const note = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  title: 'Groceries',
  titleIsCustom: false,
  body: '# Groceries\nmilk',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  deletedAt: null,
  rev: 'devA0001',
  ...extra,
})

const without = (key: string): Record<string, unknown> => {
  const d = note()
  delete d[key]
  return d
}

const copy = (extra: Record<string, unknown> = {}) =>
  note({ conflictOf: 'n0', conflictBase: { title: 'Groceries', titleIsCustom: false, body: 'eggs' }, ...extra })

const as = (uid: string) => env.authenticatedContext(uid).firestore()
const anon = () => env.unauthenticatedContext().firestore()

async function seed(path: string, data: Record<string, unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(path).set(data)
  })
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8') } })
})

beforeEach(async () => {
  await env.clearFirestore()
})

afterAll(async () => {
  await env.cleanup()
})

describe('ownership', () => {
  it('the owner may create, read, list, update and delete their own Note', async () => {
    await assertSucceeds(as('u1').doc(PATH).set(note()))
    await assertSucceeds(as('u1').doc(PATH).get())
    await assertSucceeds(as('u1').collection('users/u1/notes').get())
    await assertSucceeds(as('u1').doc(PATH).set(note({ body: 'bread', rev: 'devA0002' })))
    await assertSucceeds(as('u1').doc(PATH).delete())
  })

  it("another signed-in user may not write a Note into u1's path", async () => {
    await assertFails(as('u2').doc(PATH).set(note()))
  })

  it("another signed-in user may not read, list, update or delete u1's Notes", async () => {
    await seed(PATH, note())
    await assertFails(as('u2').doc(PATH).get())
    await assertFails(as('u2').collection('users/u1/notes').get())
    await assertFails(as('u2').doc(PATH).set(note({ body: 'mine now', rev: 'devB0001' })))
    await assertFails(as('u2').doc(PATH).delete())
  })

  it('an unauthenticated request may neither read nor write', async () => {
    await assertFails(anon().doc(PATH).set(note()))
    await seed(PATH, note())
    await assertFails(anon().doc(PATH).get())
    await assertFails(anon().collection('users/u1/notes').get())
  })

  it('nothing outside users/{uid}/notes is readable or writable, even by the owner', async () => {
    await assertFails(as('u1').doc('users/u1').set({ anything: true }))
    await assertFails(as('u1').doc('users/u1/other/x').set(note()))
    await assertFails(as('u1').doc('notes/n1').set(note()))
  })
})

describe('the nine-field allowlist', () => {
  it('accepts an ordinary Note with rev and neither conflict field', async () => {
    await assertSucceeds(as('u1').doc(PATH).set(note()))
  })

  it('denies a document with rev absent', async () => {
    await assertFails(as('u1').doc(PATH).set(without('rev')))
  })

  it('denies an empty rev', async () => {
    await assertFails(as('u1').doc(PATH).set(note({ rev: '' })))
  })

  it.each(['title', 'titleIsCustom', 'body', 'createdAt', 'updatedAt', 'deletedAt'])('denies a document missing %s', async (key) => {
    await assertFails(as('u1').doc(PATH).set(without(key)))
  })

  it('accepts a fully populated Conflict copy (conflictOf + conflictBase) — the amendment regression test', async () => {
    await assertSucceeds(as('u1').doc(PATH).set(copy()))
  })

  it('denies a Conflict copy carrying a tenth field', async () => {
    await assertFails(as('u1').doc(PATH).set(copy({ baseContent: null })))
  })

  it('denies an ordinary Note carrying an unknown field', async () => {
    await assertFails(as('u1').doc(PATH).set(note({ pendingRev: 'devA0002' })))
  })

  it('accepts conflictOf alone and conflictBase alone — the rules do not require them together', async () => {
    await assertSucceeds(as('u1').doc(PATH).set(note({ conflictOf: 'n0' })))
    await assertSucceeds(as('u1').doc('users/u1/notes/n2').set(note({ conflictBase: { title: 'x', titleIsCustom: true, body: '' } })))
  })

  it("does not validate conflictBase's interior — its shape is the domain's", async () => {
    await assertSucceeds(as('u1').doc(PATH).set(note({ conflictBase: { anything: 1 } })))
  })
})

describe('field types', () => {
  it('accepts a non-empty title', async () => {
    await assertSucceeds(as('u1').doc(PATH).set(note({ title: 'x' })))
  })

  it('denies an empty title', async () => {
    await assertFails(as('u1').doc(PATH).set(note({ title: '' })))
  })

  it('accepts deletedAt as a number (a Tombstone)', async () => {
    await assertSucceeds(as('u1').doc(PATH).set(note({ deletedAt: 1_700_000_000_001 })))
  })

  it.each([
    ['title', 42],
    ['titleIsCustom', 'false'],
    ['body', 7],
    ['createdAt', '1700000000000'],
    ['updatedAt', '1700000000000'],
    ['deletedAt', '1700000000001'],
    ['deletedAt', false],
    ['rev', 12345678],
    ['conflictOf', 99],
    ['conflictBase', 'eggs'],
  ])('denies %s as a wrongly-typed %j', async (key, value) => {
    await assertFails(as('u1').doc(PATH).set(note({ [key]: value })))
  })
})

describe('createdAt is immutable after creation', () => {
  it('accepts an update that keeps createdAt', async () => {
    await seed(PATH, note())
    await assertSucceeds(as('u1').doc(PATH).set(note({ body: 'bread', rev: 'devA0002', updatedAt: 1_700_000_000_500 })))
  })

  it('denies an update that changes createdAt', async () => {
    await seed(PATH, note())
    await assertFails(as('u1').doc(PATH).set(note({ body: 'bread', rev: 'devA0002', createdAt: 1_600_000_000_000 })))
  })
})

describe('updatedAt is not absurdly future-dated (more than a day ahead of the server)', () => {
  it('accepts an updatedAt an hour ahead — ordinary clock skew', async () => {
    await assertSucceeds(as('u1').doc(PATH).set(note({ updatedAt: Date.now() + 3_600_000 })))
  })

  it('denies an updatedAt two days ahead, on create and on update', async () => {
    await assertFails(as('u1').doc(PATH).set(note({ updatedAt: Date.now() + 2 * DAY_MS })))
    await seed(PATH, note())
    await assertFails(as('u1').doc(PATH).set(note({ rev: 'devA0002', updatedAt: Date.now() + 2 * DAY_MS })))
  })
})
