# Feature: Local store (the mirror)
Status: in-progress
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
- [x] **Row shape fixed as literal types** — `architecture.md`, "The types", 2026-09-01. This was
      what blocked the contract suite; it is unblocked.
- [x] **`NoteStore` contract test suite (fake + `idb`) — build step 2, 2026-09-06.** One suite,
      65 cases, run against `memoryNoteStore` and `idbNoteStore`. Covers get/put/getAll/delete,
      copy-not-alias on every read and on put, optional wire fields surviving as *absent* rather
      than present-and-undefined, `meta` (including a stored `false` distinguished from unset),
      transactions spanning both object stores with rollback of notes *and* meta, and durability
      across close/reopen. `fake-indexeddb` runs the real `idb` path under vitest.
      **The suite is mutation-tested, not trusted** — it went green on its first run, and eight
      deliberate breakages of each store were checked to fail it. One did not: the aliasing test
      covered `get` and not `getAll`, which is the read the corpus is actually built from. Fixed.
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

- `lastServerState` (Mathematician's extended 02 check, appendix) stays **out of the stored row** —
  in-memory, owned by the sync engine, rebuilds from 03's own full re-read on every fresh tab —
  designer — 2026-08-25

- Server-clock (`serverSeq: serverTimestamp()`) watermark to replace the full re-read per open —
  **considered and deferred, not rejected on the old reason.** Badrish's question dissolved the
  client-clock-skew objection; it stays out because a filtered query never delivers removals, so a
  hard delete elsewhere would leave the Note in the mirror forever, and `persistentLocalCache`'s
  resume token fixes the same read cost correctly for one line — designer — 2026-08-26
- A server-assigned value can never be 02's identity token: the push must know the token before the
  round trip or a retry after a lost response can't recognise its own landed write — designer —
  2026-08-26

- **The row is `NoteDoc` + `id` + `baseRev` + `pendingRev` + `baseContent`** — amends 03's "and
  nothing else". `baseContent` (the content at `baseRev`) is forced: 02 requires a Conflict copy to
  carry the fork-point content, and at push time the row holds our tip and `lastServerState` holds
  theirs, so the fork point exists nowhere. Not the `synced`-boolean mistake — it carries a fact no
  other field carries. Local-only, never serialised — designer — 2026-09-01
- **`NoteDoc` carries no `id`**, and `conflictOf`/`conflictBase` are absent rather than null —
  forced by 01's *closed* rules allowlist: an extra field or an explicit null is a denied write, and
  a denied write shows up as a stuck Outbox, not an error — designer — 2026-09-01
- **The `baseContent` invariant is *enforced* by the store, not merely asserted by the suite.**
  `assertRowInvariant` guards every write in both implementations, so no write path can put a
  violating row on disk. A test that only inspects rows the test itself constructed proves the test
  correct, not the store — the same objection that moved the `extends` guard onto the gateway's
  object. Its predicate is `baseContent !== null ⟺ pendingRev !== null && baseRev !== null`, which
  is **pending the Mathematician's confirmation** (open question below); if he corrects it, it is
  one function in `store/noteStore.ts` — builder — 2026-09-06
- **The fake is opened and deleted by uid, exactly like the `idb` database, and survives `close()`.**
  Ticket 09 simulates a second device as a second store instance, and a device that forgets
  everything when its tab closes is not a device — builder — 2026-09-06
- **`runInTransaction` spans both object stores.** 03 requires the first snapshot's corpus write and
  `initialSyncCompletedAt` to land in one commit; split in two, a crash between them renders a
  genuine empty account to a user who has notes — builder — 2026-09-06
- Branded `NoteId`/`Rev`/`DeviceId` over bare `string` — three same-shaped strings meet in the copy
  id, and a mix-up would typecheck and fail as a wrong equality inside the reconcile. Reversal is
  three lines — designer — 2026-09-01

## Open questions
- **Is the enforced `baseContent` biconditional the right predicate?** The store now rejects rows
  that violate it, so if it is *stronger* than what actually holds, a legitimate row becomes an
  unwritable one. Sent to the Mathematician 2026-09-06 as part of the capture-point question; see
  `conflict-sync.md`. Contained: one function, nothing consumes the store yet. Waiting on:
  mathematician
- Growth story past ~2,000 Notes / ~20 MB — deferred to the map's "Not yet specified"
- Read cost per app open under Android's constant background/reap cycle — Builder's step-7
  measurement decides whether `persistentLocalCache` comes back on. Waiting on: builder
