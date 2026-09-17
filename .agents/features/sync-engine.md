# Feature: Sync engine (Outbox, push, conflict copies)
Status: in-progress
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
- [x] `domain/reconcile` — `beginPush` / `decide` (three equality tests + conflict branch) /
      `commitPush` (local bookkeeping, the capture rule). `src/domain/reconcile.test.ts`. Step 3,
      2026-09-17.
- [x] `domain/applySnapshot` — all 14 cells, one test each; cell 7 keeps `baseContent`; 02's two
      traps covered (cell 10 no-op; delete-lost never adopts over typing). Step 3, 2026-09-17.
- [x] `domain/conflictCopy` — flight-token id + rev (defect 2; the pristine guard is **retired**,
      not built), 1500-byte UTF-8 cap, `conflictOf` / `conflictBase`, P-ABS omission. Step 3.
- [x] `domain/edit` — `recordEdit` / `newLocalNote`, capture point 1. Step 3.
- [x] `sync/remoteGateway` (port), `sync/fakeGateway`, `sync/engine` — step 4, 2026-09-17, commit
      `5343d58`. Two engine instances, own memory stores, one `FakeServer`: optimistic transactions
      over `{noteId, copyId}` retried on contention, a `beforeWrite` hook between read and write, a
      holdable coalescing listener, an injected `ManualClock`. Covered: clean sync, edit propagation,
      conflicting edits → copy with fork point, delete-vs-edit both orders (Tombstone not
      resurrected), commit-of-the-committed-attempt, the adopt view (three cases incl. the restart
      hole), the commit/snapshot exclusive section, complete and from-cache batches, snapshot-apply
      failure + stale-batch drop, gate + parallelism, backoff 1s→60s, success/snapshot reset,
      `Auto sync` off, permanent failures, local commit failure, the timeout. Plus a 400-seed
      two-engine walk (convergence + prefix-based content preservation). **23 mutants** (20 engine,
      1 domain leak, 1 fake, 1 store) each turn the final suite red. Gate after the last change:
      typecheck 0, lint 0, **697/697**. The walk alone sees 5 of 10 mutants tried on it — it is a
      supplement, not the guard; each engine rule has its own targeted test.
- [x] `memoryNoteStore` serialises transactions as IndexedDB does — contract test, both stores.
- [x] Structural: ESLint forbids `Date`, timers, `performance`, `navigator` in `sync/engine.ts`,
      tested both directions in `importBoundary.test.ts`.
- [ ] `sync/firestoreGateway` + emulator: real transaction semantics
- [x] **Ticket 09's import-boundary guard is built and passing** — `src/test/importBoundary.test.ts`,
      landed at step 0 rather than step 5. Tested in both directions, with negative controls; it
      immediately caught the boundary silently not working (layered ESLint config objects replace
      `no-restricted-imports` rather than merging it).
- [ ] The second half of 09's guard: an intra-file assertion that `runTransaction` is the only write
      path *inside* `firestoreGateway.ts`. The boundary stops the call being written elsewhere, not
      being written wrongly there. Lands with the gateway at step 5.
- [x] **The `LocalNote extends NoteDoc` leak guard** — step 4. `assertWireDoc` runs on every object
      the fake hands its transaction (step 5's gateway must call it too); engine tests assert the
      key sets for an ordinary Note (7) and a fully populated Conflict copy (9, `conflictBase` 3),
      both as written by the conflict branch and re-pushed as a row. Negative control: a flight doc
      spread from the row, with the fake's own assertion disabled, fails both key-set tests.
- [x] **The `baseContent` capture rule, and the lineage assertion that proves it** — step 3,
      2026-09-17. Fixture `src/test/syncHarness.ts` remembers content (and parent) per rev; the
      lineage assertion, P-INV, P-CB, P-ABS, P1b and a local P1 run after every event. Gaps A, B, C
      are `src/test/sync.lineage.test.ts`, each titled with and running the Mathematician's trace.
      Plus seeded random walks (3,200 × 30 steps: both starts, purge on/off, coalescing and in-order
      stale delivery) driven to quiescence with a convergence check. **Negative controls:** ten
      mutants of the rules (designer two-point rule, Gap-A-only, nomigrate, cell 7 cleaned, migrate
      onto any copy row, adopt-over-typing, cell-10 adopt, defect-2 overwrite, conflict-never-adopts,
      landed-stays-dirty) each turn the final suite red — all ten re-run against it 2026-09-17 (count
      corrected from "nine": Gap-A-only had only been run before P1 was added). Not a model check.

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

- **`commitPush` lives in `domain/reconcile.ts`, not `sync/engine.ts`.** The architecture table put
  "applying `PushOutcome`" in the engine; that is where the capture rule lives, so it had to be a pure
  unit for Gaps A/B/C to be step-3 tests. The engine applies its `RowWrite[]`, it does not re-derive
  them — builder — 2026-09-17
- **`lastServerState` entries are the whole `NoteDoc`**, not 02's five fields: adopt needs
  `createdAt`/`updatedAt`/`conflictOf`/`conflictBase`, and the narrow shape would erase a copy's
  `conflictBase` on its next push. Builder found it, mathematician confirmed it as a defect in his
  defect-1 fix — 2026-09-17
- **Capture point 3 = the copy's content at `flightRev`, not its `conflictBase`.** 02 appendix 3's
  sentence said `conflictBase`; the code did not follow it; mathematician ruled the sentence wrong
  and it is corrected in 02 and `architecture.md` — 2026-09-17
- **Commit cells 02 did not state, filled by builder and confirmed by mathematician, 2026-09-17:**
  row absent or already clean at commit → no writes; a *superseded* copy (decide wrote nothing) is
  never a migration target; not typed + free target → the clean copy row is inserted eagerly; an
  adopt whose server view is absent deletes the local row (including the P-ABS shape — the delivery
  re-inserts it); copy `createdAt = updatedAt =` the in-flight `updatedAt`. Gap C's continuation
  trace branches from *before* the first `cpush(1,N)` (his confirmation; as written it cannot run).

- **Step 4 sequencing — mathematician's rulings, 2026-09-17, built by builder:**
  (1) adopt view chosen at *commit* time inside an engine-exclusive section shared with snapshot
  applies; (2) **the view is keyed on this session's first complete batch, not on the persisted
  `initialSyncCompletedAt`** — the persisted flag with an empty in-memory map deleted rows at app
  open. This supersedes the wording of Badrish's Day 5 brief and of 02 defect 1; no push gate;
  (3) an empty from-cache batch at offline open is not complete: only the first `fromCache ===
  false` batch (full docs) deletes absent rows or stamps `initialSyncCompletedAt`; only server
  batches reset backoff or wake; (4) a timed-out push keeps its Note gated until the gateway settles
  (releasing admits two same-device flights → spurious copies of the user's own text); late
  results commit normally; (5) permanent errors parked per `(noteId, pendingRev)`, never looped;
  (6) `lastServerState` updated only after the store commit; a failed apply resubscribes.
- **`runPush` returns `{ action, read }` of the committed attempt — confirmed, not amended.**
  `subscribeNotes` **amended** to `SnapshotBatch { fromCache, complete, changes: {id, doc|null}[] }`
  — the sketch's `NoteDoc[]` carried no ids and no removals — builder — 2026-09-17
- Timeout surfaces but does **not** arm backoff (the gated Note cannot use the retry, and it would
  double-count a late failure); the backoff timer is an automatic wake, so `Auto sync` off pushes
  nothing on it; a commit re-drains with its originating trigger — builder — 2026-09-17
- `lastServerState` is a `Map` inside `engine.ts`, not its own file — builder — 2026-09-17

## Open questions
- ~~Step 4 owes: adopt view; `ConflictCopyIdTooLongError`~~ — closed at step 4, see Decisions.
- **Ticket 03 line 118** ("set once, when the first snapshot for this uid has been applied") should
  say a *server-backed* (`fromCache === false`) snapshot — waiting on Badrish; it is his record.
- Step 5 owes: `firestoreGateway` must compute `complete`/`fromCache` from
  `includeMetadataChanges: true` snapshots, map Firestore error codes to `PermanentPushError`, and
  call `assertWireDoc` before every `transaction.set`.
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
