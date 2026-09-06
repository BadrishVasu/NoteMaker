# Feature: The Note model (document shape, title, rules)
Status: in-progress
Owner: builder
Tickets: [01 · Firestore data model](../../.scratch/notes-mvp/issues/01-firestore-data-model.md),
title UX in [05 · Editor and shell](../../.scratch/notes-mvp/issues/05-editor-and-shell-ux.md).
Architecture: [`architecture.md`](../../.scratch/notes-mvp/architecture.md), "The types"

## What it is
What a Note *is*, before anything syncs it or renders it: the nine wire fields under
`users/{uid}/notes/{noteId}`, the four local-only fields the mirror row adds, the one function that
turns the second into the first, and the rules that decide what a Note is called. Everything else in
the app reads one `title` field and never has to know the latch exists.

Created 2026-09-06 because this slice had no feature file — ticket 01's model was being tracked
only as a dependency of other features, so build step 1 had nowhere to be recorded.

## State
- [x] Document shape decided — ticket 01, 2026-08-25; amended to nine fields 2026-08-26 to admit
      Conflict copies (`rev`, `conflictOf`, `conflictBase`)
- [x] **`src/domain/note.ts` exists as a real, compiling file** — transcribed verbatim from
      `architecture.md`'s "The types", 2026-09-06. Typechecks under the two non-default flags it
      assumes, `strict` and `exactOptionalPropertyTypes`, both already set in `tsconfig.json`.
- [x] **Build step 1: `src/domain/title.ts`** — `resolveTitle` / `isDefaultTitle` / `nextUntitledN`,
      41 tests, red first. Pure: no clock, no I/O, `N` passed in.
- [ ] `domain/projection.ts` — corpus → list / trash / search views (06 lands here)
- [ ] Security rules (`firestore.rules`) + emulator tests — build step 5. The rules do not exist
      yet; `npm run rules:deploy` would fail today. Deliberate: tests first.
- [ ] The title UI itself — the input whose emptiness *is* the latch (05) — build step 6

## Decisions
- Nested `users/{uid}/notes`, title always persisted, `Untitled Note N` as the Default title that
  makes a non-empty-title rule safe — ticket 01 — 2026-08-25
- Rules amended to the full nine-field closed allowlist; a tenth field is a *denied write*, which
  surfaces as a stuck Outbox rather than an error — builder — 2026-08-26
- The types are the Designer's, landed verbatim and unaltered — builder — 2026-09-06

Step 1's three underdetermined points, taken by the Builder rather than escalated. Each is one
function, pure, and reversing any of them is a line:
- **A body line that is only heading markers (`###`) is skipped, not accepted-then-trimmed.** 01
  says "first non-empty line ... markers stripped"; stripping first and testing after is the only
  reading that cannot produce an empty title, which the security rule forbids — builder — 2026-09-06
- **A Custom title is trimmed and tested for emptiness on the trimmed value**, so `"   "` falls to
  the Default title instead of being stored as a blank name that passes the non-empty rule. Custom
  titles are not truncated; only Derived ones are capped at 100 (01 caps only the derivation) —
  builder — 2026-09-06
- **In the Default branch, an existing `Untitled Note N` on the row is kept rather than
  reallocated.** This is what implements 01's "existing Notes are never renumbered": the row is
  still Derived, so its stored title can only be a previous resolution of this same function. A
  *stale Derived* title (`Groceries`, body since emptied) is replaced — builder — 2026-09-06
- **`nextUntitledN` scans every title in the mirror, Custom ones included.** A Note the user
  deliberately named `Untitled Note 4` still occupies 4; handing a new Note the same string buys
  nothing and reads as a bug — builder — 2026-09-06

## Open questions
- ~~**`sameContent`'s doc comment does not match its signature.**~~ **Answered: the Builder is
  right, on both halves.** `ForkPoint` has no `deletedAt`, so the body cannot do what the comment
  claimed; the code is correct as landed and stays byte-for-byte. Comment rewritten in
  `src/domain/note.ts` and in architecture.md's copy (kept identical), saying explicitly that
  `sameContent` is the *content half* only and naming where the rest lives. Testable seam #4 moved
  to `domain/reconcile`, against `ServerState`, at build step 3:
  `sameContent(ours, theirs) && (ours.deletedAt !== null) === (theirs.deletedAt !== null)`.
  Closed by designer, 2026-09-06.
- Two offline devices can allocate the same `N`. Flagged in 01 as an accepted assumption, not a
  confirmed decision; duplicate titles are legal anyway. Left as 01 left it.
