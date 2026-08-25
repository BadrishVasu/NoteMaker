# Feature: Local store (the mirror)
Status: not-started
Owner: designer (architecture) → builder (implementation)
Tickets: [03 · Local store choice](../../.scratch/notes-mvp/issues/03-local-store-choice.md),
constrained by [02](../../.scratch/notes-mvp/issues/02-conflict-copy-mechanism.md) and
[01](../../.scratch/notes-mvp/issues/01-firestore-data-model.md)

## What it is
The device-local copy of the user's whole Note corpus. It is the source of truth the UI, the list,
the Trash and search all read from, and the only place an unpushed offline edit exists. Firestore is
network transport around it, not a store the app reads.

## State
- [x] Architecture decided — ticket 03 resolved, 2026-08-25
- [ ] `NoteStore` contract test suite (fake + `idb`)
- [ ] `applySnapshot` / `reconcile` pure units
- [ ] Mirror boot, `initialSyncCompletedAt`, `navigator.storage.persist()`
- [ ] BroadcastChannel cross-tab invalidation

## Decisions
Full reasoning lives on ticket 03; the constraints that forced each, in one line:
- One own mirror, Firestore on `memoryLocalCache()` — forced by 02: `runTransaction` means offline
  edits never enter the SDK cache, so they exist only in ours — designer — 2026-08-25
- `idb` over Dexie, whole corpus in memory — no query is ever issued, so a query engine is dead
  weight; also closes 01's composite-index deferral as "none required" — designer — 2026-08-25
- Outbox is a column (`pendingRev !== null`), not a table — forced by wanting "edit and enter the
  Outbox" to be one atomic row write — designer — 2026-08-25
- BroadcastChannel, no leader election — 02 relieved leader election of correctness duty — designer
  — 2026-08-25
- `navigator.storage.persist()` is mandatory — unpushed edits live only here, and default IndexedDB
  is evictable — designer — 2026-08-25

- Sign-out keeps the local Notes; `persist()` on first sign-in, silent retry per open if denied, and
  05's sync strip drops "they're safe on this device" while denied — Badrish — 2026-08-25

## Open questions
- Growth story past ~2,000 Notes / ~20 MB — deferred to the map's "Not yet specified"
