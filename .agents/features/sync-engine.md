# Feature: Sync engine (Outbox, push, conflict copies)
Status: not-started
Owner: builder
Tickets: [02 · Conflict-copy mechanism](../../.scratch/notes-mvp/issues/02-conflict-copy-mechanism.md),
[09 · Sync test strategy](../../.scratch/notes-mvp/issues/09-sync-test-strategy.md).
Architecture: [`architecture.md`](../../.scratch/notes-mvp/architecture.md)

## What it is
The thing that makes a Note written on one device appear on the other without ever losing a write.
Edits land in the local mirror and enter the Outbox; the engine drains the Outbox through one
Firestore transaction per Note, which either pushes cleanly, adopts the server's version, or
preserves our text as a Conflict copy. Incoming snapshots update clean Notes and never touch a dirty
one.

## State
- [x] Mechanism decided and model-checked — ticket 02
- [x] Architecture proposed and Builder responded — `architecture.md`
- [ ] `domain/reconcile` — 02's three equality tests + conflict branch
- [ ] `domain/applySnapshot` — 02's two model-checked traps as named regression tests
- [ ] `domain/conflictCopy` — deterministic id, pristine guard, `conflictOf` / `conflictBase`
- [ ] `sync/engine` — the drain loop, wake sources, backoff
- [ ] `sync/firestoreGateway` + emulator: real transaction semantics
- [x] **Ticket 09's import-boundary guard is built and passing** — `src/test/importBoundary.test.ts`,
      landed at step 0 rather than step 5. Tested in both directions, with negative controls; it
      immediately caught the boundary silently not working (layered ESLint config objects replace
      `no-restricted-imports` rather than merging it).
- [ ] The second half of 09's guard: an intra-file assertion that `runTransaction` is the only write
      path *inside* `firestoreGateway.ts`. The boundary stops the call being written elsewhere, not
      being written wrongly there. Lands with the gateway at step 5.
- [ ] **The `LocalNote extends NoteDoc` leak guard — lands HERE, at step 4, with `fakeGateway`.**
      Written onto this file three steps early so it survives. Detail under Decisions.
- [ ] **The `baseContent` capture rule, and the lineage assertion that proves it.** Both land here,
      not at step 2. Detail under Decisions; the three named regression tests are Gaps A, B and C
      from 02 appendix 3, each with the Mathematician's own trace as the test body.

## Decisions
- Import boundary replaces 02's name list: only `sync/firestoreGateway.ts` may import
  `firebase/firestore`, enforced by ESLint. Needs a second intra-file assertion that `runTransaction`
  is the only write path there — a name list cannot anticipate `addDoc`/`writeBatch` — builder —
  2026-08-25
- ~~Outbox drain is serialised until per-Note push independence is confirmed~~ — **withdrawn
  2026-08-26**: the Mathematician's appendix confirms per-Note independence is total. `engine.ts`
  gets a `Map<noteId, Promise>` gate — one in-flight push per Note, free parallelism across Notes.
- Snapshot delivery is the push loop's connectivity oracle; `navigator.onLine` stays dead — builder —
  2026-08-25
- **Push triggers**: wake on a local edit, `visibilitychange → visible`, snapshot delivery, a backoff
  timer, and `Sync Now`. Backoff 1s doubling to 60s, reset on any successful push or any snapshot.
  **Hard 10s per-push timeout** — `runTransaction` retries internally and can hang far past a user's
  patience — builder — 2026-08-26
- **`deviceId`**: `meta` object store, per-uid, `crypto.randomUUID()` truncated to 8 chars, never
  rotated; the composed copy id is length-checked against Firestore's 1500-byte doc-id cap in
  `domain/conflictCopy.ts`, since a Conflict copy can itself conflict and nest the pattern — builder
  — 2026-08-26
- **`Auto sync` gates the `begin-push` trigger only.** `pendingRev` mints at edit-time in both
  settings, so 02's snapshot guard predicate never widens — mathematician / Badrish — 2026-08-26
- `initializeFirestore` lives in `sync/firestoreGateway.ts`, not `platform/firebase.ts`, so the
  import boundary needs **no exceptions** — builder — 2026-08-26

- **The `LocalNote extends NoteDoc` leak guard belongs at step 4, on the object the gateway hands
  the transaction.** Designer decision #5 takes ergonomics over structural safety (`extends` means
  nothing stops a whole mirror row — `baseContent`, a full body copy — reaching Firestore) and pays
  for it with one runtime assertion. His proposed form, `Object.keys(toNoteDoc(x))` equals the
  expected key set, **can only fail if `toNoteDoc` is wrong**; the leak `extends` actually creates
  is a write path that never calls `toNoteDoc`, structurally satisfies `NoteDoc`, and typechecks.
  So the assertion goes on the object handed to the transaction. That reasoning is unchanged.

  **Correction to the placement, and it is Badrish's, 2026-09-06:** the 2026-09-06 journal entry
  said this was "still the first test written at step 2." That is wrong — no gateway exists until
  step 4 (`fakeGateway`), so there is nothing at step 2 for the assertion to sit on. Step 2 shipped
  without it, correctly. Two key-set assertions, one for an ordinary Note and one for a fully
  populated Conflict copy — builder — 2026-09-06

- **`baseContent`'s capture is an engine rule, and it is keyed to a state change, not to a branch**
  — mathematician, 2026-09-06 (02, appendix 3). Stated once: *`baseContent := the content that was
  in flight` at every transition where `baseRev := flightRev` and the row stays dirty; `null` at
  every transition where the row goes clean.* That is **four** transaction branches — clean push,
  already-landed (`srv.rev === pendingRev`, i.e. retry / lost response / second tab), recreate into
  an absent document, and the first landing of an unlanded create — **plus** the conflict-branch
  outbox-slot migration of defect 3, which the Designer's rules never mentioned and which is the one
  that writes a two-generations-stale `conflictBase` to a real server document. No `applySnapshot`
  cell captures: cell 9 is the only dirty-row `baseRev` advance and it clears dirty; **cell 7 retains
  `baseContent` and that is correct, not a leak** — the fork point is a fact about a rev, not about
  the live document, and the model reaches the trace where the retained value is later written as a
  correct `conflictBase` after another device recreates the doc. Do not "clean it up".
- **The step-2 store invariant does not cover this, and must not be read as covering it** —
  builder, 2026-09-06. `P-INV` is confirmed exactly right and stays enforced on every write, but it
  is a *shape* check: a row carrying the wrong `baseContent` satisfies it, and it survived ~900k
  states against the Gap-C design without firing while the lineage property failed at depth 6. So
  step 3's reconcile tests need a fixture that **remembers content per rev**, and the assertion is
  *`baseContent` equals the content this row's `baseRev` was written with*. That fixture is a
  prerequisite of the reconcile tests, not an extra — without it the capture rule is untested.

## Open questions
- None blocking the engine's own work. One dependency elsewhere:
  - ~~The literal `NoteDoc` / `LocalNote` types~~ — landed as `src/domain/note.ts`, 2026-09-06.
  - Ticket 13's purge must respect appendix cell 7 (dirty row + absent server doc = no-op). Noted on
    13; not this feature's to solve.

## Answered since last session
- Complete `applySnapshot(localRow, serverDoc)` table **including absent `serverDoc`** — delivered as
  02's appendix (14 cells). 02's original model had indeed omitted `snapshot-delivered` as an event;
  adding it found three real defects, all folded into `architecture.md`.
- Transaction-retry re-execution: does not admit an interleaving the model ruled out.
- 01's stale security rules: **fixed in the ticket**, amended to the full nine-field set with the
  Conflict-copy acceptance test named for step 5.
