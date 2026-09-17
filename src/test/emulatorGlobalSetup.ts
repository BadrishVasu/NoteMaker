// Step 5: `npm run test:emulator` runs this suite inside `firebase emulators:exec`, which sets
// FIRESTORE_EMULATOR_HOST before the test process starts. Running the emulator config directly
// (`vitest run --config vitest.emulator.config.ts`, or an editor's "run test" button) skips that
// wrapper, and without it `@firebase/rules-unit-testing` either hangs waiting for a connection or,
// worse, reaches for a real Firestore backend. Fail immediately and say why, rather than let the
// suite hang or silently skip.
export default function setup(): void {
  if (!process.env['FIRESTORE_EMULATOR_HOST']) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is not set. Emulator tests must run via `npm run test:emulator` ' +
        '(firebase emulators:exec), never vitest directly against vitest.emulator.config.ts.',
    )
  }
}
