# QA notebook

## 2026-09-21 (Day 8, re-confirmation) — both fixes hold; verdict upgraded to verified

**Verdict: verified.** Builder fixed both items from my Day 8 pass same-session. Re-confirmed each,
then tried to break them with sequences neither Builder's nor my own original tests covered.

**1. The alias fix (`saveNote.ts`).** `redirected` is now a one-hop map, repointed (never chained)
on every redirect, and `seed(row)` deletes any alias keyed at the id being opened — "opening `from`
starts a new stream at `from`." Builder rewrote my tripwire block in `step7.qa.test.ts` to assert
the corrected outcome, exactly as its own comment asked (reopen edits `N`, the copy is untouched, 2
docs total) — checked the diff, it says what I'd have wanted it to say. Builder's own new suite in
`saveNote.test.ts` ("the redirect alias is per edit stream") already covers the chain case I would
have reached for (`a → b → c`, reopen `b` mid-chain, a stale keystroke for `a` still lands at `c`).

Tried to break it further, added to `step7.qa.test.ts`: reopening `N` after an alias history, then
letting the FRESH stream at `N` conflict again on its own merits (B reopens `N`, types, and loses a
second race with A while typing). Redirects correctly a second time, to a brand-new copy, and the
first copy from the earlier conflict is untouched by any of it — no stale bookkeeping misroutes or
swallows the genuinely new conflict. Full two-device engine + save queue + one `FakeServer`, not a
queue-only unit test.

**2. The re-seed race fix (`AppShell.tsx`, `useLayoutEffect`).** Builder's own MutationObserver
regression test proves the body-focused case (red before, green after, rendered outside `act` so
the passive-effect gap can't be hidden). I specifically went after the case that test doesn't
cover: focus in the **Title** field, not the body — a per-field bug in `refocus`'s branch
(`label === 'Note body' ? 'body' : label === 'Title' ? 'title' : null`) wouldn't show up testing
only one field. Added `src/app/AppShell.qa.test.tsx` (3 tests): title-focus re-seed keeps focus in
Title, the same one-task MutationObserver technique confirms the corpus row (and therefore the
save queue's `base`) has already moved by the DOM's first mutation regardless of which field is
focused, and "never re-seeds over unsaved typing" repeated for the Title field specifically (an
unsaved title blocks the re-seed even though only the body changed remotely — confirms the guard is
keyed on the whole buffer, not per-field).

Did not find a way to break either fix. Both held under everything I could design against them
within this session's scope.

### Test runs
- `npm test`: **40 test files, 961 tests, all green** (957 after Builder's fixes + 4 more of mine:
  1 reincarnation test in `step7.qa.test.ts`, 3 in the new `AppShell.qa.test.tsx`).
- `npx tsc --noEmit`, `npm run lint`: clean. `npm run build`: clean.
- Did not re-run `test:emulator` — untouched by anything either of us changed this round.

## 2026-09-21 (Day 8) — Step 7 verification: auth gate, session, four first-load states, save path

**Verdict: verified-with-defects.** Everything in scope short of the live two-device Google
sign-in run (mine to skip; that's Badrish's) holds, with one real finding for the Mathematician's
open item and no new defects of my own.

### What I did
Read `architecture.md`'s Composition root section, `05-screens.md`'s SignIn/StorageError
additions, `02-conflict-copy-mechanism.md`'s 2026-09-21 amendment, then every file the prompt
named: `App.tsx`, `platform/auth.ts`, `session.ts`, `StorageError.tsx`, `AppShell.tsx`,
`saveNote.ts`, `domain/edit.ts`, `sync/engine.ts`'s `createExclusive`, `domain/reconcile.ts`'s
`redirectTarget`. Then read every existing test next to them first — `App.test.tsx`,
`AppShell.step7.test.tsx`, `session.test.ts`, `SignIn.test.tsx`, `auth.test.ts`,
`src/test/savePath.test.ts` — since Frontend/Builder's own suites are already thorough. My job
was the sequences those suites didn't write.

Added `src/test/step7.qa.test.ts` (7 tests, all real: `openSession` + `createSaveQueue` + the
shared write lock + one `FakeServer`, same rig as `savePath.test.ts`, no mocks of the thing under
test):
- delete/restore race inside one debounce window — converges, no torn state.
- create-then-conflict on a brand-new offline Note whose create hasn't landed yet — clean push,
  no spurious copy, both devices converge.
- a redirect, then more typing on the copy, then a SECOND conflict on that copy — redirects twice,
  correctly, never silently overwrites.
- sign-out mid-push — `session.close()` genuinely blocks on the in-flight push (server-side gate,
  not just the local commit) and only resolves after it lands.
- account switch with pending, unflushed typing — closing a session without going through
  `AppShell`'s flush-first order silently drops the buffer (never partially pushed) — correct
  outcome, but only correct *because* `App.tsx`'s sign-out helper and `AppShell.handleSignOut`
  both flush first; nothing at `session.close()` itself would catch a caller that skipped it.
  Noting this as a contract that lives entirely in the caller, not enforced by the callee.

### Finding for the Mathematician's open item — reopening the original Note after a redirect

Confirmed, and worse than the prompt's framing suggested. `saveNote.ts`'s `redirected` map (`from
→ to`) has no expiry and `resolve()` chases it unconditionally. `AppShell`'s own re-seed path
(`saveQueue.seed(openNote)` in the layout effect, keyed on `openNote.id`) triggers it: if the user
deliberately navigates back to the original Note `from` after a redirect (a completely normal
thing to do — click it in the list, or follow the conflict banner's own copy back) and types,
`seed`/`schedule` silently resolve `from` to `to` and buffer/commit the edit there — using `from`'s
own current row as the base, not `to`'s.

Reproduced in `step7.qa.test.ts`'s last `describe` block. The actual outcome under the real engine
is not "silently overwrites the copy" — the base mismatch (buffer's `base` is `from`'s row, but
the commit reads `to`'s actual current row) trips `bufferEdit`'s own conflict detection, so it
spins into a **second, unprompted conflict copy**: `N → copy1 → copy1-of-copy1`. Neither `N` (what
the user is actually looking at) nor `copy1` (what the redirect banner pointed them at) ever
receives the typed text; it lands on a third Note the shell had no reason to create and the user
never asked for, and which is not what any conflict banner is currently pointing them to. This
is worse than a wrong-target write — it's an unbounded fan-out: reopening `N` a second time after
this would resolve straight through to `copy1-of-copy1` too, so the chain only grows.

Test is pinned as a tripwire (asserts today's actual, buggy outcome, with a comment saying it is
expected to go red and be updated once the Mathematician's fix lands) — not asserted as spec, and
not a regression test to keep green forever. Fix is explicitly out of scope for me per the prompt.

### First-load states, auth gate, sign-in copy — confirmed correct, no gaps worth padding

`session.test.ts`'s four first-load-state cases (new-device-online, new-device-offline via
`waitingForConnection`, returning-device online, returning-device offline) already cover the state
machine precisely against `SessionStatus`, snapshot-delivery-as-oracle (no `navigator.onLine`
anywhere — grepped). `App.test.tsx` already covers: renders nothing pre-auth-report, signed-out
shows `SignIn`, sign-in-error copy per kind, account switch closes the old session, a session that
resolves after sign-out is closed unread, sign-out ordering (flush → close → signOut, asserted by
literal order array), and the StorageError screen with Reload. `SignIn.test.tsx` covers all three
`signInErrorOf` outcomes plus the popup-closed/cancelled non-error case verbatim against
`05-screens.md`'s copy. I did not find a gap worth adding to over these — they're already the
integration layer, not just unit tests of the pure function.

### Browser check — could not do the interactive part

No browser-automation tool is available to me in this environment (no MCP browser/DOM control, no
screenshot capture). `npm run dev` was already serving on :5173; `curl`ing it only returns the
unrendered SPA shell (client-side React), which proves nothing about the signed-out screen. I did
**not** fake this check. What stands in its place: `App.test.tsx` and `SignIn.test.tsx` render the
real components through `@testing-library/react` and assert the actual DOM (button text, `role`,
alert copy) — that is the closest verification available to me. The signed-in shell needs real
Google sign-in, which is off-limits to me per the prompt; not attempted, not worked around.
Recommend Badrish's own manual pass cover: the signed-out screen's actual pixels in a real browser
window (I have not seen them at all this session), and the signed-in shell end to end.

### Test runs
- `npm test`: **39 test files, 953 tests, all green** (947 existing + 6 new `step7.qa.test.ts`).
- `npx tsc --noEmit`, `npm run lint`: clean.
- `npm run build`: clean, PWA precache unaffected.
- Did not run `npm run test:emulator` — nothing I touched needs it; the prompt's 74/5 gate is
  Builder's to keep green, unchanged by this session's additions.

### Dead ends
- Initially wrote `copies()` (a helper borrowed from `savePath.test.ts`, `id !== N`) into the
  create-then-conflict test for a fresh Note id that isn't `N` — every id in that server "is a
  copy" by that definition, giving a false failure. Fixed by asserting `server.ids(UID)` directly
  instead of reusing a helper built for a different fixture's shape.

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
