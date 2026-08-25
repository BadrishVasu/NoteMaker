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
- [ ] Ticket 09's guard: no Note write outside `runTransaction`

## Decisions
- Import boundary replaces 02's name list: only `sync/firestoreGateway.ts` may import
  `firebase/firestore`, enforced by ESLint. Needs a second intra-file assertion that `runTransaction`
  is the only write path there — a name list cannot anticipate `addDoc`/`writeBatch` — builder —
  2026-08-25
- Outbox drain is serialised until per-Note push independence is confirmed — builder — 2026-08-25
- Snapshot delivery is the push loop's connectivity oracle; `navigator.onLine` stays dead — builder —
  2026-08-25

## Open questions
- Complete `applySnapshot(localRow, serverDoc)` decision table, including absent `serverDoc`, and
  whether 02's model included `snapshot-delivered` as an event at all — waiting on mathematician
- Does Firestore's transaction-retry re-execution admit an interleaving the model ruled out —
  waiting on mathematician (asked by designer)
- Where `deviceId` is minted and stored — waiting on designer
- Push trigger + backoff policy blessed or corrected — waiting on designer
- 01's security rules predate `rev`/`conflictOf`/`conflictBase` and will reject Conflict copies —
  mine to fix at emulator step
- The 30-day purge is a hard delete and is unspecified; recommend no purge in v1 — needs a ticket
