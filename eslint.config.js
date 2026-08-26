import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * The architecture's module boundaries, enforced rather than remembered.
 *
 * Two of these are load-bearing on proofs, not on style:
 *
 *  - Only `src/sync/firestoreGateway.ts` may import `firebase/firestore`. Ticket 02's central
 *    invariant is that every Note write goes through `runTransaction`; a stray `setDoc` or `addDoc`
 *    anywhere else silently reintroduces the whole data-loss class. This makes there be exactly one
 *    file where such a call could physically be written, which is what ticket 09's guard test then
 *    has to cover.
 *  - `src/domain/` reads no clock. Ticket 02 dissolved ticket 01's clock-skew debt precisely because
 *    reconciliation reads no time. A `Date.now()` under `domain/` silently un-proves that.
 *
 * `no-restricted-imports` is REPLACED, not merged, by a later matching config object. So every
 * scope below declares its complete set of restrictions rather than inheriting any. An earlier
 * revision layered them and silently disabled the firestore boundary for most of `src/` — which is
 * exactly why `src/test/importBoundary.test.ts` tests this file in both directions.
 */

const FIRESTORE = {
  group: ['firebase/firestore', 'firebase/firestore/*'],
  message:
    'Only src/sync/firestoreGateway.ts may import firebase/firestore. Ticket 02: every Note write ' +
    'goes through runTransaction, and this boundary is what makes that structural rather than a ' +
    'convention.',
}

const FAKES = {
  group: ['**/fakeGateway', '**/memoryNoteStore'],
  message:
    'Fakes live in src/ so the contract suite typechecks them against the real port, but ' +
    'production code must never import one.',
}

const IMPURE = {
  group: [
    'firebase',
    'firebase/*',
    'idb',
    'react',
    'react-dom',
    '../store/*',
    '../sync/*',
    '../platform/*',
    '../app/*',
  ],
  message:
    'src/domain/ is pure TypeScript: no I/O, no React, no Firebase, no IndexedDB. Everything it ' +
    'needs is passed in as data.',
}

const restrict = (...patterns) => ['error', { patterns }]

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'coverage', 'node_modules'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // Default for everything under src/.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': restrict(FIRESTORE, FAKES) },
  },

  // domain/ is pure and reads no clock.
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': restrict(FIRESTORE, FAKES, IMPURE),
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message:
            'src/domain/ reads no clock. Ticket 02 dissolved ticket 01’s clock-skew debt because ' +
            'reconciliation reads no time — stamp updatedAt at the edge and pass it in as data.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'NewExpression[callee.name="Date"]',
          message: 'src/domain/ reads no clock. Pass the timestamp in as data.',
        },
      ],
    },
  },

  // Tests and the fakes themselves are the only things allowed to import a fake.
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/**/fake*.ts', 'src/**/memory*.ts', 'src/test/**/*.ts'],
    rules: { 'no-restricted-imports': restrict(FIRESTORE) },
  },

  // The one sanctioned firebase/firestore importer in the codebase.
  {
    files: ['src/sync/firestoreGateway.ts'],
    rules: { 'no-restricted-imports': restrict(FAKES) },
  },
)
