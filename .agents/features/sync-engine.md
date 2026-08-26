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

## Open questions
- None blocking the engine's own work. Two dependencies elsewhere:
  - The literal `NoteDoc` / `LocalNote` types — waiting on designer, blocks build step 2.
  - Ticket 13's purge must respect appendix cell 7 (dirty row + absent server doc = no-op). Noted on
    13; not this feature's to solve.

## Answered since last session
- Complete `applySnapshot(localRow, serverDoc)` table **including absent `serverDoc`** — delivered as
  02's appendix (14 cells). 02's original model had indeed omitted `snapshot-delivered` as an event;
  adding it found three real defects, all folded into `architecture.md`.
- Transaction-retry re-execution: does not admit an interleaving the model ruled out.
- 01's stale security rules: **fixed in the ticket**, amended to the full nine-field set with the
  Conflict-copy acceptance test named for step 5.
