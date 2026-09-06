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
- [x] **`baseContent`'s capture points model-checked** (02 appendix 3, 2026-09-06). Three gaps in
      the designer's two-point rule; one writes a stale `conflictBase` to the server. `P-INV`
      confirmed safe to enforce, but shown strictly weaker than the real property.
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
- `baseContent` is captured at every transition that sets `baseRev := flightRev` on a still-dirty
  row — not only the clean push — and cleared whenever the row goes clean. Pin the lineage
  assertion alongside the biconditional; the biconditional alone misses the conflict-migration gap
  — mathematician — 2026-09-06
- **architecture.md corrected in place** — the superseded two-capture-point rule is marked, not
  deleted, and the corrected state-keyed rule replaces it. Rules in this design are to be written
  against *state changes*, not against branches; `applySnapshot`'s 14-cell state table is the form
  to prefer. Swept the artifact for other branch-keyed rules: none found — designer — 2026-09-06
- **Testable seam #4 moved off `sameContent`.** Its doc comment claimed `deletedAt` compares as a
  boolean; `ForkPoint` has no `deletedAt`, so it never did and never could. Code unchanged (correct
  as landed); comment fixed in both `src/domain/note.ts` and the artifact. The deletedAt-as-boolean
  rule lives at the caller, `domain/reconcile`, against `ServerState` — Builder's position, agreed
  by designer — 2026-09-06. Seams are renumbered: 6 = the `baseContent` lineage assertion at
  `reconcile` (with the three model-checked gaps as named regressions), 7 = the fast-forward test
  including deletedAt-as-boolean.

## Open questions

- ~~Does manual-send break the snapshot-overwrite guard?~~ Answered in 02's amendment, 2026-08-25:
  no, provided `pendingRev` mints at edit time. Closed by designer, 2026-09-01.
- ~~Are `baseContent`'s two capture points sufficient?~~ **Answered: no** — 02 appendix 3,
  mathematician, 2026-09-06. Three gaps. Corrected rule: *`baseContent := the in-flight content` at
  every point where `baseRev := flightRev` and the row stays dirty; `null` whenever the row goes
  clean* — which covers four transaction branches, not one, plus the conflict-branch outbox-slot
  migration the designer's rules never mention. On the Builder's three additions: (a) no
  `applySnapshot` cell needs a capture — cell 9 is the only dirty-row `baseRev` advance and it
  clears dirty; the risk was in the *push* path, not the snapshot path; (b) confirmed, `baseRev ===
  null` is the only absent-`conflictBase` case; (c) the biconditional is **exactly right** under the
  corrected rule — neither too strong nor too weak — and safe to enforce on every store write, but
  it is a *shape* check that does not catch the worst gap. Closed.
