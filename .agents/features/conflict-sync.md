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
- [x] **Manual-send re-check — answered** (02's amendment, 2026-08-25). The break UI/UX suspected is
      real only under *their* implementation (minting `pendingRev` at send-press). `pendingRev` mints
      at edit time in both modes, so `pendingRev !== null` stays the correct dirty predicate; the
      setting gates only the flush trigger. This checkbox was left open past its answer — corrected
      by designer, 2026-09-01.
- [x] **Snapshot path model-checked** (02 appendix, 2026-08-25). Three defects found, all folded in:
      `lastServerState`, the flight-token copy id, and "only adopt what this push just wrote".
- [x] **The literal `NoteDoc` / `LocalNote` types** — architecture.md, "The types", designer,
      2026-09-01. Blocked build step 2; no longer.
- [ ] Nothing built. No app code exists in this repo yet.

## Decisions

- Own outbox over per-device documents plus a version vector — mathematician — 2026-08-25
- `rev` is an opaque random token, not a counter or a timestamp — mathematician — 2026-08-25
- Server's version survives a conflict; the reconciling device's edit becomes the Conflict copy —
  mathematician, confirmed by Badrish — 2026-08-25
- No automatic three-way merge, ever — mathematician — 2026-08-25
- A losing delete is dropped (Note revives); a losing edit survives as a live Conflict copy —
  mathematician, confirmed by Badrish — 2026-08-25

- The mirror row must carry `baseContent` (the content at `baseRev`), or `conflictBase` cannot be
  written correctly — the fork-point content exists nowhere else at push time, and 02 states it is
  unretrofittable. Found while writing the types — designer — 2026-09-01

## Open questions

- ~~Does manual-send break the snapshot-overwrite guard?~~ Answered in 02's amendment, 2026-08-25:
  no, provided `pendingRev` mints at edit time. Closed by designer, 2026-09-01.
- Are `baseContent`'s two capture points (clean→dirty, and commit-of-a-clean-push) sufficient for
  `conflictBase` to always equal the content at `baseRev` on the lineage? Reasoned, not checked —
  same class of claim as 02's original snapshot rules, which were wrong. Not a step-2 blocker; the
  field's presence is what step 2 commits to. **Sent to the mathematician 2026-09-06**, with three
  additions to the brief: run it with `snapshot-delivered` as an event (the two capture points are
  stated only in terms of edit and commit-push, so an `applySnapshot` cell that moves `baseRev`
  without moving `baseContent` is the shape at risk); confirm the unlanded create is the *only*
  reachable absent-`conflictBase` case; and say whether the biconditional
  `baseContent !== null ⟺ pendingRev !== null && baseRev !== null` is implied by his result or is
  stronger than what holds — build step 2 now **enforces** it on every store write, so a predicate
  that is too strong rejects legitimate rows. Waiting on: mathematician
