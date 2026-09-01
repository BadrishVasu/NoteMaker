import { beforeAll, describe, expect, it } from 'vitest'
import { ESLint } from 'eslint'

/**
 * The import boundary is load-bearing on ticket 02's proof, so it gets tested in BOTH directions.
 *
 * A lint rule that matches nothing and a codebase with no violations look identical from the
 * outside. Every one of these positive cases therefore has a negative control proving the rule is
 * not simply passing everything.
 *
 * This is ticket 09's structural guard, landed at step 0 rather than step 5, because it costs
 * nothing here and because the boundary needs to exist before there is code to violate it.
 */

const eslint = new ESLint({ cwd: process.cwd() })

async function messagesFor(filePath: string, source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath, warnIgnored: false })
  return (result?.messages ?? []).map((m) => `${m.ruleId ?? 'unknown'}: ${m.message}`)
}

function hasRestrictedImport(messages: string[]): boolean {
  return messages.some((m) => m.startsWith('no-restricted-imports'))
}

/**
 * Prime ESLint before the timed tests run.
 *
 * The FIRST `lintText` call is the expensive one: it resolves the flat config and loads
 * typescript-eslint from disk. Warm, every case here finishes in milliseconds; cold — a fresh clone,
 * a CI runner, or straight after `npm ci` — that first call alone can exceed vitest's 5s per-test
 * budget, and the test that pays the cost is whichever happens to run first.
 *
 * Observed 2026-09-01: this suite failed 1/12 on a cold cache and passed 12/12 immediately after.
 * A timeout here reads as "the import boundary is broken", which is a false alarm on the one guard
 * that ticket 02's proof actually rests on — and the tempting response to a flaky guard is to skip
 * it. So the config load gets its own generous budget here, and each test below keeps a tight
 * default that still means something: with the config already loaded, a slow case is a real signal.
 */
beforeAll(async () => {
  await messagesFor('src/test/__warmup__.ts', 'export const warm = true\n')
}, 120_000)

describe('the firebase/firestore import boundary', () => {
  it('rejects firebase/firestore from an ordinary module', async () => {
    const messages = await messagesFor(
      'src/app/Editor.tsx',
      `import { setDoc } from 'firebase/firestore'\nexport const x = setDoc\n`,
    )
    expect(hasRestrictedImport(messages)).toBe(true)
  })

  it('rejects firebase/firestore from inside sync/, which is the tempting place to write it', async () => {
    const messages = await messagesFor(
      'src/sync/engine.ts',
      `import { runTransaction } from 'firebase/firestore'\nexport const x = runTransaction\n`,
    )
    expect(hasRestrictedImport(messages)).toBe(true)
  })

  it('allows firebase/firestore in firestoreGateway.ts, the one sanctioned file', async () => {
    const messages = await messagesFor(
      'src/sync/firestoreGateway.ts',
      `import { runTransaction } from 'firebase/firestore'\nexport const x = runTransaction\n`,
    )
    expect(hasRestrictedImport(messages)).toBe(false)
  })

  // Negative control: proves the rule discriminates rather than flagging every import.
  it('does not flag an unrelated import', async () => {
    const messages = await messagesFor('src/app/Editor.tsx', `import { openDB } from 'idb'\nexport const x = openDB\n`)
    expect(hasRestrictedImport(messages)).toBe(false)
  })
})

describe('domain/ purity', () => {
  it('rejects Date.now() under domain/', async () => {
    const messages = await messagesFor('src/domain/reconcile.ts', `export const t = Date.now()\n`)
    expect(messages.some((m) => m.startsWith('no-restricted-properties'))).toBe(true)
  })

  it('rejects new Date() under domain/', async () => {
    const messages = await messagesFor('src/domain/reconcile.ts', `export const t = new Date()\n`)
    expect(messages.some((m) => m.startsWith('no-restricted-syntax'))).toBe(true)
  })

  it('rejects an idb import under domain/', async () => {
    const messages = await messagesFor(
      'src/domain/reconcile.ts',
      `import { openDB } from 'idb'\nexport const x = openDB\n`,
    )
    expect(hasRestrictedImport(messages)).toBe(true)
  })

  // Negative controls: the clock and purity rules are scoped to domain/ and must not leak upward.
  it('allows Date.now() outside domain/, where updatedAt is legitimately stamped', async () => {
    const messages = await messagesFor('src/store/saveNote.ts', `export const t = Date.now()\n`)
    expect(messages.some((m) => m.startsWith('no-restricted-properties'))).toBe(false)
  })

  it('allows an idb import in store/, which is what store/ is for', async () => {
    const messages = await messagesFor(
      'src/store/idbNoteStore.ts',
      `import { openDB } from 'idb'\nexport const x = openDB\n`,
    )
    expect(hasRestrictedImport(messages)).toBe(false)
  })
})
