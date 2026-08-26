# Feature: Editor and app shell
Status: not-started
Owner: ui-ux (design) → frontend (build)
Tickets: [05 · Editor and app-shell UX](../../.scratch/notes-mvp/issues/05-editor-and-shell-ux.md)

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
- [ ] Nothing built. No app code exists in this repo yet. Builds at step 6, after the deploy
      pipeline and the pure-logic slices.

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

## Open questions
- None blocking. Placement of the `Sync Now` control and the `Auto sync` setting is UI/UX's at build
  step 6 — a scoped design task, not an open decision. Naming and semantics are settled and are not
  theirs to revisit.

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
