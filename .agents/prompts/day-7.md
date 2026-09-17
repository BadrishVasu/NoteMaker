# NoteMaker — Day 7 prompt (step 6: shell, list, editor)

Paste this as the first message of the next session.

---

Builder — NoteMaker, Day 7. Work in the main checkout, `E:\Projects\Claude\NoteMaker`, on `main`.
**No worktrees from this session onward** — that is Badrish's call, made at the end of Day 6. Don't
create one, and don't ask an agent to.

## 0. Housekeeping first, before any build work

The Day 6 session has ended, so its worktree is free to remove. From `E:\Projects\Claude\NoteMaker`:

```
git worktree remove .claude/worktrees/notemaker-day6-step5-d35669
git worktree prune
git branch -d claude/notemaker-day6-step5-d35669
git worktree list
git branch -a
```

`-d`, never `-D`: if git refuses, the branch has an unmerged commit and that is a finding, not an
obstacle to force past — stop and report it.

Then delete **both** leftover folders, which are empty directories the earlier removals left behind:

- `E:\Projects\Claude\NoteMaker\.claude\worktrees\notemaker-builder-step-4-7c1d55`
- `E:\Projects\Claude\NoteMaker\.claude\worktrees\notemaker-day6-step5-d35669`

They were held open by a live Claude session before; with those sessions gone they should delete.
If one still refuses, say so plainly rather than retrying in a loop.

## 1. Session-start checks

```
git status
git fetch origin
git rev-parse HEAD origin/main
git branch --no-merged main
git log --branches --not origin/main --oneline
```

`--no-merged` and the `--branches --not origin/main` log are the pair that caught the Day 6 miss —
comparing `HEAD` with `origin/main` alone cannot see work sitting on another branch. Report the
unpushed range from the second command, per commit. Every push still needs Badrish's word on an
exact range, and his word covers that range only.

**One extra check this session, once:** after your first sub-agent has run and finished, and while
nothing else is running, list `C:\Users\Chotu\.claude\.agent-locks\` and confirm no `.live.*` files
are left behind. The logbook-gate hook fix (`.live.<agent_id>` markers, `.since` rolled forward at
SubagentStart) was applied on Day 6 with the Overseer's changes — 9/9 on the Mathematician's cases,
plus 4 sequences of the Overseer's. A leaked marker only delays a `.since` deletion, so it is not
urgent, but it is the one thing the fix's own tests could not prove in a live session. The reasoning
is in the Mathematician's and Overseer's notebooks under `.agents/notes/`.

## 2. The work — step 6

From `architecture.md`'s build order:

> 6. **Shell, list, editor** (05 variant A) against a seeded store, still no network. The app
>    becomes usable offline-only at this point.

Steps 0–5 are done: the pipeline and live host, `domain/title`, the `store/` contract suite,
`reconcile` + `applySnapshot` + `conflictCopy`, `sync/engine` against `fakeGateway`, and
`firestoreGateway` against the emulator with the rules tests. As of the end of Day 6: 715 unit tests
in 14 files, 72 emulator tests in 4 files, all passing.

Read before you start: `.agents/JOURNAL.md` (top entries), `.agents/features/editor-and-shell.md`,
`.agents/notes/builder.md`, ticket `.scratch/notes-mvp/issues/05-editor-and-shell-ux.md`, and the
throwaway prototype at `.scratch/notes-mvp/prototypes/05-shell/index.html`.

Step 6 is the first slice that is genuinely UI, so it is the first one where the build team earns
its coordination cost: UI/UX turns ticket 05 into concrete screens and states, Frontend builds
against them. TDD holds — failing test first, every time, including for the projection and the
corpus. Watch these, which are already decided and easy to quietly violate:

- `corpus.ts` holds a `Map<noteId, LocalNote>` of **immutable rows** with stable identity plus a
  version counter, under `useSyncExternalStore`. No store library.
- The import boundary stands: only `sync/firestoreGateway.ts` may import `firebase/firestore`.
  Step 6 touches no network at all.
- No offline badge, no `navigator.onLine`, anywhere. Sync affordance is per-Note Outbox state only.
- The title latch is one-way with no UI escape hatch. Badrish's call, against both recommendations.
- Editor follows the content, not the id: `corpus.ts` emits a redirect, `Editor` does
  `history.replaceState`.

## 3. Open follow-ups, carried in

- **Firestore rules deploy to the live project is still not done.** Badrish gave the word on Day 6,
  but the Firebase CLI has no signed-in account on this machine and signing in is his to do, not
  an agent's. Once he has run `firebase login`, deploy naming the project explicitly —
  `firebase deploy --only firestore:rules --project <the project id in ticket 04>` — there is no
  `.firebaserc`, so a bare `npm run rules:deploy` would target whatever project the CLI has active.
  Run `npm test` and `npm run test:emulator` first and confirm the released project and ruleset from
  the CLI's own output afterwards.
  **Before that deploy: run `npm ci` in the main checkout.** `firebase-tools` is a devDependency and
  the main checkout's `node_modules` predates it — there is no `firebase` binary there, and there is
  no global install either (`firebase` is not on PATH; invoke it via the npm script or
  `npx firebase`). Day 7 runs without worktrees, so this gap is directly in the way. `firebase login`
  credentials are global (`%APPDATA%\configstore\firebase-tools.json`), so Badrish signing in once
  from any directory covers every checkout.
- **Read cost must be measured at step 7, not inherited.** Ticket 03 priced the per-open full
  re-read against desktop-shaped opens; the design assumes Android reaps the app constantly, so
  20–50 opens/day. `persistentLocalCache` is the sanctioned one-line reversal if the number is bad.
- Still open after step 6: step 7 (auth, `persist()`, the four first-load states, two-device
  end-to-end), then tickets 06 search, 12 back-button, 11 merge.

## 4. Before you finish

Write the session entry in `.agents/JOURNAL.md`, update
`.agents/features/editor-and-shell.md` in place (`Status:` must be true at all times), and add to
`.agents/notes/builder.md` — dead ends included. Commit the logbook tagged `docs`. Report the
unpushed range to Badrish by SHA and wait for his word before pushing.
