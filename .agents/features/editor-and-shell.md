# Feature: Editor and app shell
Status: verified
Owner: ui-ux (design) → frontend (build)
Tickets: [05 · Editor and app-shell UX](../../.scratch/notes-mvp/issues/05-editor-and-shell-ux.md)
Spec: [`design/05-screens.md`](../../.scratch/notes-mvp/design/05-screens.md) — the buildable form of 05

## What it is
The surfaces the user actually touches: the Note list, the markdown editor, search placement, Trash,
and how the Outbox is surfaced. Everything a Note is read and written through.

## State
- [x] UX decided end to end — layout, states, interactions. Detail on ticket 05, not restated here.
- [x] Throwaway prototype built: `.scratch/notes-mvp/prototypes/05-shell/index.html`
- [x] Badrish reacted; his four calls folded into ticket 05 under "Settled with Badrish"
- [x] **`Sync Now` + `Auto sync`** — settled by Badrish 2026-08-26. Nothing about the save path is
      open any more; the editor is fully spec'd.
- [x] Body-size sync threshold corrected from ~1 MiB to **~450 KiB** — a Conflict copy carries two
      bodies in one document, so the old number produced a permanently stuck Outbox behind a strip
      saying everything was fine.
- [x] **Screens spec** written by UI/UX, 2026-09-18 — `design/05-screens.md`. Builder's rulings
      folded in by UI/UX.
- [x] **Built at step 6, 2026-09-18**, against a seeded local store, no network. `sync/corpus.ts`,
      `domain/projection.ts`, `domain/size.ts` (builder); `src/app/**`, `platform/lifecycle.ts`,
      `platform/prefs.ts` (frontend, then builder's review fixes). 860 unit tests in 32 files,
      72 emulator tests in 4 files, lint, typecheck and build all green.
- [x] **Checked in a real browser by builder** at 1280px and 375px against `?seed`: list, open,
      new Note focuses the body, Default placeholder, title latch (title-then-body order), the
      custom-emptied copy, Preview (raw HTML inert, `javascript:` link dropped), search and
      no-results, Trash banner + read-only + Restore, strip in Auto-sync on and off states,
      persistence across reload, no `initialSyncCompletedAt` written, no console errors.
- [x] **QA-verified, 2026-09-21** — verdict *verified-with-defects*, one defect (`handleNewNote` had
      no `.catch`), fixed by builder and re-confirmed by QA. QA added 7 integration tests. See
      `.agents/notes/qa.md`.
- [x] **Flaky test root-caused and fixed, 2026-09-21** — the AppShell new-Note focus test, not the
      lineage walks. Passive-effect focus left a real unfocused frame; now `useLayoutEffect`,
      pinned by a deterministic MutationObserver test.
- [x] Boot failure (IndexedDB won't open) now shows a terminal message instead of an infinite
      "Getting your notes…". Added **after** QA's run; covered by its own test, not QA-verified.
      Its copy was builder's; **UI/UX confirmed it on 2026-09-21** and spec'd it as `StorageError`
      (full screen, one `Reload` button) in 05-screens.md, built at step 7.
- [x] **Badrish tested step 6 locally himself, 2026-09-21** (`npm run dev`, `/?seed`), after
      builder's green light: "Testing is done. Great job team!" Status stays `verified`, not
      `shipped` — nothing is pushed, so nothing is deployed.
- [x] Totals after the QA round: **869 unit tests in 34 files**, 72 emulator tests in 4 files;
      lint, typecheck, build green; 7 consecutive full-suite runs green on the final code.
- [x] **Step 7, 2026-09-21 — auth, session, first-load states, the save path rebuilt.**
      `App.tsx` gates on auth state (renders nothing until Firebase reports; `SignIn` with UI/UX's
      three outcome copies; `StorageError` with Reload). `AppShell` runs on a `Session` (no longer
      opens storage). The four first-load states come from session status. Sign-out is flush →
      `session.close()` → `auth.signOut()`. `Sync Now` flushes the debounce, then syncs; turning
      Auto sync on wakes the engine; `visibilitychange → visible` wakes it. The dev `?seed` path is
      removed (`devSeed.ts` deleted: its fake-rev rows mean nothing against a real server).
- [x] **Save queue rebuilt on 02's amendment**: buffer + base per open Note; a commit reads the
      stored row inside the lock and is ordinary only if the row still shows base (`bufferEdit`).
      The redirect alias serves only the edit stream open at redirect time (mathematician's review;
      QA found the id-keyed version sent edits of a reopened original to the copy and spun off a
      third copy).
- [x] **Re-seed** (UI/UX ruling): a remote edit to the idle open Note remounts the editor silently,
      caret to 0, focus kept in its field. Runs in a **layout** effect, pinned by a MutationObserver
      test (a passive effect left a gap that clean-overwrote the other device).
- [x] **Popstate now remounts the Editor.** Step 6 kept the previous Note's text under the new id
      on browser back between two Notes, and the next keystroke wrote it there. Fixed test-first.
- [x] Signed-out screen checked in a real browser at 1280 and 375 px (centred, no horizontal
      scroll, no console errors). **The signed-in shell has not been looked at against live
      Firebase**: that needs Badrish's sign-in.
- [x] QA, step 7: **verified**, after the alias and re-seed fixes were re-confirmed.
- [x] Totals after step 7: **961 unit tests in 40 files, 74 emulator tests in 5 files**; lint,
      typecheck, build green (957 before QA added 4).
- [ ] Live two-device end to end on `notemaker-claude` (Badrish signs in; steps in the Day 8 report).
- [ ] Real PWA icons — still placeholder art; UI/UX deferred it out of the step-6 spec.

## Decisions
- No "offline" state anywhere; all sync affordance is per-Note Outbox state — ui-ux — 2026-08-25
- Master-detail shell; markdown typed as markup — ui-ux — 2026-08-25
- One mode, Write; preview is an invoked action, not a mode; no split-pane — Badrish — 2026-08-25
- Derived title = empty input with the resolved title as placeholder; first keystroke is the latch
  — ui-ux — 2026-08-25
- Title latch is one-way with **no UI escape hatch**, against both recommendations — Badrish —
  2026-08-25
- `N notes waiting to sync` strip stays; new Notes focus the body; untouched new Notes are kept
  — Badrish — 2026-08-25
- Conflict redirect is a silent swap: no visible text or selection change, `replaceState` — ui-ux —
  2026-08-25
- The button is **`Sync Now`**, the setting family is **`Auto sync`**; nothing user-facing says
  "push" or "manual save" — Badrish — 2026-08-26
- `Auto sync` gates only the `begin-push` trigger; `pendingRev` is minted at edit-time in both
  settings, so 02's snapshot guard never widens — mathematician / builder — 2026-08-26
- Sync-blocking body threshold is ~450 KiB, not ~1 MiB — builder — 2026-08-26
- `Sync Now` sits in the list header; `Auto sync` is a toggle in the list header's overflow menu —
  ui-ux — 2026-09-18
- SyncStrip clauses are independent, not ranked: the reassurance clause drops on persist-denied,
  the `Sync now` action appears when Auto sync is off — four states. Overrode UI/UX's ranking,
  which suppressed the action for the persist-denied user — builder — 2026-09-18 (Badrish has not
  responded; standing as built)
- The too-large-to-sync check counts UTF-8 bytes (`domain/size.ts`), never code units — builder —
  2026-09-18
- `Auto sync` is a device preference in `localStorage` (`platform/prefs.ts`), NOT a store `meta`
  key — keeps ticket 03's `MetaShape` untouched — builder — 2026-09-18. Designer told 2026-09-21: no objection.
- Preview is a closed, hand-rolled markdown subset returning React elements only; no
  `dangerouslySetInnerHTML`, no markdown dependency — builder — 2026-09-18
- `initialSyncCompletedAt` has one writer, `sync/engine.ts`. Step 6 treats the mirror as settled
  in memory for display and persists nothing — builder — 2026-09-18
- The save queue takes `schedule(id, change)` — only the changed fields — and merges onto pending
  → in-flight → live corpus row. A handler cannot revert a field it didn't touch — builder —
  2026-09-18

## Open questions
- None blocking step 7.

## Step 7 must handle — all closed at step 7, 2026-09-21 (kept for the record)
- **A pending save across a conflict redirect.** The save queue keys pending and in-flight
  content by `noteId`. If the redirect lands inside the 600 ms debounce, the user's latest
  keystrokes flush to `from` — the id that now holds the *other* device's text — instead of to the
  copy they are looking at. Not data loss (it re-conflicts), but wrong, and it touches 02's
  outbox-slot-migration rule, so it goes to the Mathematician with the engine wiring, not
  improvised here. Seam: `AppShell`'s redirect subscriber.
- **Sign-out and `Sync Now` are inert at step 6.** `Sync Now` has no engine to drain; the
  spec'd `Sign out` menu item has no session. Both are the spec's sanctioned step-7 seams, along
  with the conflict banner's `Compare` (ticket 11).
- **`LOCAL_UID = 'local'`** in `AppShell.tsx` is the swap point for the signed-in uid; the
  `?? Date.now()` fallback for `initialSyncCompletedAt` in the same file is deleted once the
  engine stamps it. A step-6 browser's `notemaker-local` database is simply abandoned.
- A failed local write in the save queue is `console.error`-logged only. The text stays in the
  editor buffer and the next keystroke retries, but nothing tells the user. Ticket-worthy if it
  can happen outside quota exhaustion.

## Resolved this session
- **Mathematician re-checked the snapshot-guard break UI/UX flagged.** Real, but only under the
  candidate plan of minting `pendingRev` at send-press. Fix: mint `pendingRev` at edit-time
  unconditionally (unchanged from 02), gate only the `begin-push` trigger on the manual-send
  setting. 02's guard predicate (`pendingRev !== null`) is untouched; no re-verification needed
  beyond a schedule-subset argument. See amendment in
  `.scratch/notes-mvp/issues/02-conflict-copy-mechanism.md` and
  `.agents/notes/mathematician.md`. `blur`/`visibilitychange`/`pagehide` force nothing extra in
  manual mode — durability was never gated by the flush.

## Depends on
- Ticket 11 owns the Conflict-copy badge and the merge surface; 05 reserved a list-row slot for it.
- Ticket 06 owns search matching; 05 decided placement only.
- Android back-button behaviour needs a ticket — flagged from 05, not yet created.
