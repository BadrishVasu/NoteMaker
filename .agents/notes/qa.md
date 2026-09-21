# QA notebook

## 2026-09-21 (addendum) — Builder fixed the defect below same-day; a flake found outside my files

**Fixed:** Builder fixed the `handleNewNote` unhandled-rejection defect this same session
(`AppShell.tsx`: `commitCreate` now wrapped in try/catch, `console.error`-logged, same policy as
`writeNow`). `AppShell.createFailure.test.tsx` was red before, is green after — verified myself,
`npx vitest run src/app/AppShell.createFailure.test.tsx` passes. It is now the regression guard,
not an open defect; Builder updated the in-file comment accordingly (assertions untouched, I
checked the diff).

**Flake, not mine, but relevant to my "no flake observed" note below:** Builder's background loop
caught `AppShell > creating a note ... focuses the body` failing ~1 in 6, in a file I touched but
did not write that test in. Root cause: `Editor`'s autofocus ran in a passive `useEffect`, a task
after the commit that inserts the textarea — a real window where a fast first keystroke could
land on "New note" instead of the body. Fixed with `useLayoutEffect`. My "no flaky pass-then-fail
observed" line below is still accurate for what I personally reran, but stands corrected: a real
flake existed in this file's suite and I did not catch it in my own runs — Builder's longer
background loop did.

## 2026-09-21 — Step 6 verification (shell, list, editor; offline-only, seeded local store)

Scope: `E:\Projects\Claude\NoteMaker`, main checkout, range `0532e87..78cbaa5`. No worktree, no
commit/push — Badrish commits. Read first: `05-screens.md`, `features/editor-and-shell.md`,
`JOURNAL.md` top entry. `.agents/notes/qa.md` did not exist yet; this is its first entry.

**Verdict: verified-with-defects.** One real defect found and pinned with a failing test (below);
everything else I went looking for held.

### What I did
Read the spec and every file it names (`AppShell.tsx`, `Editor.tsx`, `TitleField.tsx`,
`saveNote.ts`, `NoteList.tsx`, `SyncStrip.tsx`, `EmptyStates.tsx`, `markdown.tsx`, `size.ts`,
`title.ts`, `lifecycle.ts`, `prefs.ts`, `devSeed.ts`), then read every existing test file next to
them to find what was NOT already covered, since Frontend and Builder's own unit tests are
already thorough (saveNote.test.ts's merge-semantics suite in particular is excellent — it
already covers title-then-body, body-during-in-flight-put, and delete-during-a-typing-burst at
the queue level). My job was the integration layer above that: through `AppShell`, via real user
events, against `fake-indexeddb`.

Added 7 new tests, all real (`@testing-library/react` + `user-event` + `fake-indexeddb`), no
mocks of the thing under test except the one file that specifically needs a rejecting `store.put`:

- `src/app/AppShell.test.tsx` (+6): switching Notes mid-debounce doesn't lose the abandoned
  Note's text; deleting immediately after typing keeps the typed text on the trashed row;
  restoring then typing again immediately (mid-debounce) saves the post-restore edit; the
  Custom-emptied hint's `Untitled Note N` matches what the Note actually saves as; a window
  `blur` flushes a pending edit well inside the 600ms debounce window; `visibilitychange →
  hidden` does the same.
- `src/app/AppShell.createFailure.test.tsx` (new file, +1): a rejected `store.put` during Note
  *creation* is an unhandled promise rejection. Isolated in its own file (mocks
  `../store/idbNoteStore`) so the mock can't leak into `AppShell.test.tsx`'s shared database or
  assertions.

### Defect found — report to Frontend (or Builder, since this is `AppShell.tsx`)

**`AppShell.handleNewNote` has no `.catch` around `commitCreate`; a rejected `store.put` during
Note creation is an unhandled promise rejection**, not the console-logged, buffer-preserving,
retry-on-next-keystroke behavior `saveNote.ts`'s `createSaveQueue.writeNow` gives every *edit*.
Contrast:

```ts
// AppShell.tsx, handleNewNote — no catch:
const row = await commitCreate(deps, id, { title: '', titleIsCustom: false, body: '' })
```
```ts
// saveNote.ts, writeNow — has one:
.catch((err: unknown) => {
  console.error(`saveNote: writing Note ${id} to the local mirror failed`, err)
})
```

Repro: `npx vitest run src/app/AppShell.createFailure.test.tsx` — fails on purpose, left failing.
It wraps `openIdbNoteStore` to reject the next `put`, clicks "New note", and asserts no
`unhandledRejection` fires; today one does (visible directly in a plain `npm test` run too, as
`Vitest caught 1 unhandled error during the test run` on this file before I made the assertion
explicit). Real-world trigger: IndexedDB quota exhaustion, a locked-down embed, or a row-invariant
violation, right at the moment a user clicks "New note" or the FAB — the click just does nothing,
silently, with no error path at all (worse than an edit's failure, which the user's buffer at
least survives visibly in the editor). Not exercised by the mutation-tested `saveNote.ts` suite
because `commitCreate`'s caller, not `commitCreate` itself, is where the catch is missing.

Fix is Frontend's/Builder's, not mine — I did not touch `AppShell.tsx`.

### Confirmed correct / no defect (things I specifically went looking for and did not find)

- **Data-loss paths.** The debounce queue is keyed per-Note-id and lives on `AppShell`, not on
  `Editor`'s React lifecycle — so switching Notes mid-debounce, and Editor's resulting unmount,
  do not race the pending write; the timer fires regardless and the abandoned Note's text lands.
  Delete-mid-typing and restore-then-immediately-type both land correctly, matching what
  `saveNote.test.ts` already proved at the queue level — this just confirms the shell doesn't
  break that guarantee on the way through `handleDelete`/`handleRestore`'s explicit `flush(id)`.
  `blur` and `visibilitychange→hidden` both flush well under the 600ms window, end to end through
  `AppShell`, not just at `lifecycle.ts`'s unit level. Did not add a `pagehide` integration test
  (symmetric wiring to `blur`/`visibilitychange` in `lifecycle.ts`, already unit-level covered) —
  noting the gap rather than padding the count.
- **Title latch.** No escape hatch anywhere in `TitleField.tsx`/`Editor.tsx`/`AppShell.tsx` — one
  `onChange` call sets `titleIsCustom: true` permanently, confirmed by reading every call site.
  `isDefaultTitle` never regexes the stored string (title.ts, by construction). The
  Custom-emptied hint's live `Untitled Note {N}` matches the actual saved title exactly — both
  derive from the same `nextUntitledN` call over the live corpus, and my new integration test
  confirms the number shown before save is the number after.
- **Spec copy and states.** Spot-checked every verbatim string in `05-screens.md` against the
  component source (SyncStrip's 4 independent-clause states already had a full unit suite from
  Frontend that matches the Builder ruling exactly; EmptyStates' 5 kinds match verbatim; Trash
  banner + Restore matches; too-large strip uses `size.ts`'s UTF-8 byte count, not code units).
- **Hard constraints.** No `navigator.onLine` anywhere in app code (only in `sync/engine.ts`'s own
  comment about NOT using it, and its own boundary test). No offline badge. The
  `firebase`-import boundary is narrower and better than the brief stated: ESLint's
  `no-restricted-imports` (see `eslint.config.js`) restricts `firebase/firestore` specifically to
  `firestoreGateway.ts`, not all of `firebase/*` — `platform/firebase.ts` legitimately imports
  `firebase/app`/`firebase/auth` for step 7's auth setup, which is correct and not a step-6
  concern; verified this is the actual enforced rule, not a gap, by reading
  `src/test/importBoundary.test.ts`. Grepped `src/app` for anything importing `../sync/*` other
  than `corpus` — nothing. Conflict redirect uses `replaceState` only (already had an
  `AppShell.test.tsx` end-to-end test using spies on both; I read it, didn't need to add to it).
  Preview: raw HTML inert and non-`http(s)` links dropped to literal text — both already covered
  in `markdown.test.tsx`, confirmed by reading `markdown.tsx`'s regex (`javascript:` links simply
  never match the `https?://` link pattern, so they always fall through as literal text; there is
  no denylist to bypass).
- **Production build.** `npm run build` is clean (tsc + vite + PWA precache, no errors).
  Confirmed `devSeed.ts`'s dev-only content (`Grocery list`, `seedRequested`, `maybeSeed`) is
  fully absent from `dist/assets/index-*.js` — `import.meta.env.DEV` dead-code-eliminates the
  whole branch, not just gates it at runtime.

### Not covered (say so rather than imply otherwise)
- The step-7-deferred pending-save-across-a-conflict-redirect race (feature file's own "Step 7
  must handle" item) — correctly NOT built at step 6, not re-reported.
- The list-must-not-scroll-the-open-Note-out-of-view-during-a-redirect clause (§9) — the
  value/selection/scroll preservation on the *editor* side is tested end to end; I did not add a
  test asserting the *list*'s scroll position specifically, since jsdom's layout is fake and this
  would mostly test a scrollTop number jsdom never really moves — a real-browser check (which
  Builder already did once) is the meaningful version of this one.
- Android back-button semantics — explicitly out of scope per `05-screens.md`'s own footer.
- `Sign out` and `Sync Now` being inert stubs — spec'd seams, not defects, not re-tested beyond
  confirming they render and don't throw (they're exercised incidentally by every test that opens
  the menu / clicks Sync Now).

### Test runs
- `npx vitest run` on each touched file individually while iterating — no flaky pass-then-fail
  observed on any file I touched or reran.
- Final `npm test` (full suite, once): **33 test files, 867 tests, 1 failed (my intentional
  defect test), 866 passed.** Emulator tests untouched — did not run `test:emulator` per
  instructions.
- `npm run build`: clean.

### Dead ends
- None worth recording this session — the codebase's own tests were thorough enough that most of
  my search time went into confirming absence of a bug rather than finding one, which is the
  correct outcome to report plainly rather than manufacture something to fill the report.
