/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

// Step 5: emulator-backed tests. These hit a real Firestore emulator (Firestore security rules
// cannot be evaluated any other way), so they get their own vitest project instead of living in
// the fast jsdom suite (vite.config.ts):
//
//  - `environment: 'node'` — no DOM needed, and jsdom's setup file (testing-library matchers) is
//    irrelevant here.
//  - `fileParallelism: false` — every file in this suite shares the one emulator instance
//    launched by `firebase emulators:exec`. Vitest's default is to run test files in parallel
//    worker processes, which would race writes to the same emulator project.
//  - `globalSetup` throws if `FIRESTORE_EMULATOR_HOST` is unset, so running this suite without
//    the emulator running fails loudly instead of the rules-unit-testing SDK silently trying (and
//    hanging or timing out against) a real Firestore backend.
//
// Run via `npm run test:emulator`, which wraps this in `firebase emulators:exec` so the emulator
// starts, tests run, and it shuts down again — never run this config bare.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.emulator.test.ts'],
    exclude: ['node_modules/**'],
    fileParallelism: false,
    globalSetup: ['./src/test/emulatorGlobalSetup.ts'],
  },
})
