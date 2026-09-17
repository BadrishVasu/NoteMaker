import { afterAll, describe, expect, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'

/**
 * Step 5 smoke test: proves the emulator harness itself works — a real Firestore emulator loads
 * the real `firestore.rules`, rules are actually enforced, and `assertSucceeds`/`assertFails` see
 * the difference. This is ops' plumbing, not ticket 02's rules; Builder replaces `firestore.rules`
 * test-first and this file's rules content will change shape then, but the harness proven here
 * should not need to.
 *
 * No `firebase/firestore` import here — only `src/sync/firestoreGateway.ts` may (eslint import
 * boundary). `@firebase/rules-unit-testing`'s `RulesTestContext.firestore()` returns a compat
 * Firestore handle instead.
 */

let testEnv: RulesTestEnvironment

describe('emulator harness smoke test', () => {
  it('sets up against demo-notemaker with the real firestore.rules', async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-notemaker',
      firestore: {
        rules: readFileSync('firestore.rules', 'utf8'),
      },
    })
  })

  it('a write with rules disabled is readable back', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await db.doc('users/u1/notes/n1').set({ title: 'hello' })
      const snap = await db.doc('users/u1/notes/n1').get()
      expect(snap.data()).toEqual({ title: 'hello' })
    })
  })

  it('an authenticated write is denied by the placeholder rules', async () => {
    const asU1 = testEnv.authenticatedContext('u1')
    await assertFails(asU1.firestore().doc('users/u1/notes/n2').set({ title: 'denied' }))
  })

  it('assertSucceeds resolves for a write the rules actually allow', async () => {
    // Proves assertSucceeds itself works, not just assertFails — a harness where every write
    // fails would pass an assertFails-only suite for the wrong reason.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await assertSucceeds(context.firestore().doc('users/u1/notes/n3').set({ title: 'ok' }))
    })
  })
})

afterAll(async () => {
  await testEnv?.cleanup()
})
