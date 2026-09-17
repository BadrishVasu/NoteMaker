import { globSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fastConfig from '../../vite.config'
import emulatorConfig from '../../vitest.emulator.config'

/**
 * Step 5: proves the fast/emulator split in both directions against the real files on disk and
 * the real configs, not against copied-out glob strings that could silently drift from what
 * vitest actually uses. `npm test` (vite.config.ts) must never pick up an `*.emulator.test.ts`
 * file, and `npm run test:emulator` (vitest.emulator.config.ts) must never pick up an ordinary
 * `*.test.ts` file — either direction wrong means one suite silently runs the other's tests (or
 * none of them).
 */

function matched(include: string[], exclude: string[] = []): string[] {
  const included = new Set(globSync(include, { cwd: process.cwd() }))
  for (const path of globSync(exclude, { cwd: process.cwd() })) included.delete(path)
  return [...included].map((p) => p.replaceAll('\\', '/'))
}

describe('fast suite vs. emulator suite split', () => {
  const fastFiles = matched(fastConfig.test?.include ?? [], fastConfig.test?.exclude ?? [])
  const emulatorFiles = matched(emulatorConfig.test?.include ?? [])

  it('the fast suite (vite.config.ts) picks up an ordinary test file', () => {
    expect(fastFiles).toContain('src/test/importBoundary.test.ts')
  })

  it('the fast suite does NOT pick up the emulator smoke test', () => {
    expect(fastFiles).not.toContain('src/test/emulator.smoke.emulator.test.ts')
  })

  it('the emulator suite (vitest.emulator.config.ts) picks up the emulator smoke test', () => {
    expect(emulatorFiles).toContain('src/test/emulator.smoke.emulator.test.ts')
  })

  it('the emulator suite does NOT pick up an ordinary test file', () => {
    expect(emulatorFiles).not.toContain('src/test/importBoundary.test.ts')
  })
})
