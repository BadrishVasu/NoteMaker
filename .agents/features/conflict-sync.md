# Feature: Conflict-free sync

Status: in-progress
Owner: mathematician (mechanism) → frontend/backend (build, via the Builder's architecture)
Tickets: [02 · Conflict-copy mechanism](../../.scratch/notes-mvp/issues/02-conflict-copy-mechanism.md),
[03 · Local store](../../.scratch/notes-mvp/issues/03-local-store-choice.md)

## What it is

How a Note written offline on one device and a Note written online on another are reconciled
without either write silently disappearing, given that Firestore's own offline queue would
otherwise replay writes unconditionally and discard the loser. This is the mechanism the rest of
the app is built around — the local mirror, the editor's redirect behaviour, and the deploy
pipeline's data model all answer to it.

## State

- [x] Mechanism designed and decided — ticket 02. Own Outbox, every Note write through
      `runTransaction`, opaque `rev` token, deterministic Conflict-copy id, `conflictBase` preserved
      for a future merge.
- [x] Model-checked: 2.4M two-device interleavings to depth 7, three invariants held. Caught and
      fixed a real data-loss bug in the fork-point advance rule before it shipped.
- [x] Local store ratified against the mechanism — ticket 03. One own mirror, Firestore on
      memory-only cache, whole corpus in memory.
- [ ] **Manual-send setting re-check, in progress.** A settings toggle proposed after the mechanism
      shipped (deferring the push, not the local write) may widen the "is this Note safe to
      overwrite from an incoming snapshot" signal beyond `pendingRev !== null`. Sent to the
      mathematician to verify against the original proof rather than amend on UI/UX's own say-so.
- [ ] Nothing built. No app code exists in this repo yet.

## Decisions

- Own outbox over per-device documents plus a version vector — mathematician — 2026-08-25
- `rev` is an opaque random token, not a counter or a timestamp — mathematician — 2026-08-25
- Server's version survives a conflict; the reconciling device's edit becomes the Conflict copy —
  mathematician, confirmed by Badrish — 2026-08-25
- No automatic three-way merge, ever — mathematician — 2026-08-25
- A losing delete is dropped (Note revives); a losing edit survives as a live Conflict copy —
  mathematician, confirmed by Badrish — 2026-08-25

## Open questions

- Does manual-send break the snapshot-overwrite guard, and if so what is the corrected rule? —
  waiting on mathematician
