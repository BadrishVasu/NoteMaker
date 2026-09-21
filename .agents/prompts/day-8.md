# NoteMaker — Day 8 prompt (step 7: auth, persist(), first-load states, two devices)

Paste this as the first message of the next session.

---

Builder — NoteMaker, Day 8. Work in the main checkout, `E:\Projects\Claude\NoteMaker`, on `main`.
**No worktrees** — Badrish's standing call since the end of Day 6. Don't create one, and don't ask
an agent to.

## 1. Session-start checks

```
git status
git fetch origin
git rev-parse HEAD origin/main
git branch --no-merged main
git log --branches --not origin/main --oneline
```

`--no-merged` and the `--branches --not origin/main` log are the pair. Comparing `HEAD` with
`origin/main` alone can't see work sitting on another branch. Report the unpushed range from the
second command, per commit, as `$(git rev-parse --short origin/main)..$(git rev-parse --short HEAD)`
pasted, never typed.

**Push state at the end of Day 7: nothing pushed.** `origin/main` was `0532e87`; every local commit
above it was unpushed (all of step 6, its QA round, the logbook and this prompt). Take the
count and range from git, not from this sentence. **Badrish has not
authorised a push.** Pushing `main` deploys to `note-maker-f41.pages.dev` through Cloudflare Pages,
so a push is a production deploy of step 6. Every push needs his word on an exact range, and his
word covers that range only. If he authorises it, push by SHA
(`git push origin <sha>:main`), then prove the deploy landed from the commit's check-runs, not from
the live site's content (Builder notebook, 2026-09-16).

## 2. Before step 7 builds anything — one question for the Mathematician

**A conflict redirect landing mid-save.** The step-6 save queue keys pending and in-flight content
by `noteId`. If the engine redirects the open editor from `from` to a Conflict copy inside the
600 ms debounce, or while a `store.put` is in flight, the user's latest keystrokes flush to `from`
— the id that now holds the *other* device's text — instead of to the copy they are looking at.
It touches 02's outbox-slot-migration rule. That makes it an engine-and-queue interaction to
reason through, not to improvise. It hits two of Builder's mandatory triggers: it's expensive to
unwind once the engine is wired, and it surfaces late, as a spurious second conflict on a real
device. **Send it before step 7 wires the engine to the corpus.** The seams are the redirect
subscriber in `src/app/AppShell.tsx` and `createSaveQueue` in `src/app/saveNote.ts`. The
reasoning is in `.agents/features/editor-and-shell.md` under "Step 7 must handle".

## 3. The work — step 7

From `architecture.md`'s build order:

> 7. **Auth, `persist()`, the four first-load states**, then real end-to-end on two devices.

Steps 0–6 are done. Step 6 was QA-verified and **tested by Badrish himself, locally**, on Day 7.
Baseline at the end of Day 7: **869 unit tests in 34 files, 72 emulator tests in 4 files**, lint,
typecheck and build green.

Read before you start: `.agents/JOURNAL.md` (top entries), `.agents/features/editor-and-shell.md`
("Step 7 must handle"), `.agents/features/sync-engine.md`, `.agents/notes/builder.md`, ticket 08
(auth) and ticket 03 (the mirror, `initialSyncCompletedAt`, `persist()`).

What step 7 has to deliver:

- **Auth.** Gate UI on auth state, never on tokens (08). `SignIn` already exists as a
  presentational component, and step 7 mounts it in front of the shell. Swap `LOCAL_UID = 'local'`
  in `AppShell.tsx` for the signed-in uid (database `notemaker-<uid>`), and give `Sign out` in the
  overflow menu a real session. A step-6 browser's `notemaker-local` database is simply abandoned.
- **`navigator.storage.persist()`** via `platform/persistStorage.ts`, on first successful sign-in,
  with the answer recorded in `meta.persistGranted`. The SyncStrip's persist-denied state already
  reads it.
- **The four first-load states, live.** Downloading, downloading-offline, genuinely empty, and a
  returning device with no loading state. `initialSyncCompletedAt` has **one writer, `sync/engine.ts`**,
  on a complete server-backed batch. Delete the `?? Date.now()` display fallback in `AppShell.tsx`
  once the engine drives it.
- **Wire the engine.** `AppShell` takes an optional `corpus` prop for exactly this: the engine
  writes snapshots and emits the redirect into the same instance. `Sync Now` (header and strip) and
  the `Auto sync` setting (`platform/prefs.ts`) drive the engine's triggers. Auto sync gates only
  `begin-push`; `pendingRev` is minted at edit time in both settings.
- **Two-device end-to-end, for real**, on the live Firebase project: two devices, a real edit
  conflict, the Conflict copy, the redirect, and both converging.
- **Measure read cost; don't inherit it.** Ticket 03 priced the per-open full re-read against
  desktop-shaped opens, but Android reaps the app constantly: 20–50 opens a day. Count the reads
  per open at a realistic corpus size and put the number on record. `persistentLocalCache` is the
  sanctioned one-line reversal if it's bad.

Decided, and easy to quietly violate:

- Only `sync/firestoreGateway.ts` imports `firebase/firestore`. Nothing in `app/` imports from
  `sync/` except `corpus.ts`.
- No offline badge, no `navigator.onLine`, anywhere. The connectivity oracle is snapshot delivery.
- The title latch is one-way with no UI escape hatch (Badrish's call).
- Editor follows the content via `replaceState`, never `pushState`.
- A UI slice isn't done until it's been looked at in a real browser; jsdom can't see layout.

## 4. Open follow-ups, carried in

- **UI/UX: review the storage-failure copy.** If IndexedDB can't open, `AppShell` shows *"Can't
  open this device's note storage. Nothing has been changed — try reloading."* Builder wrote it on
  Day 7 because `05-screens.md` has no state for it. It's UI/UX's to confirm or replace, and to add
  to the spec.
- **Tell the Designer** about two step-6 changes he didn't make and should know about: `Auto sync`
  is a per-device preference in `localStorage` via `platform/prefs.ts`, deliberately **not** a store
  `meta` key, so ticket 03's `MetaShape` is untouched; and `AppShell` takes an optional injected
  `corpus` as step 7's engine seam.
- **The Mathematician on the redirect landing mid-save** — section 2, before any engine wiring.
- **Frontend's notebook entry: DONE**, written 2026-09-21 after the rate-limit cutoff and
  committed. Nothing left here. It's listed only so nobody chases it.
- **One leaked `.live.*` marker**, `C:\Users\Chotu\.claude\.agent-locks\c7007023e3c6.live.a4873fc2646d5815d`,
  from a Frontend run that died on an API rate limit without reaching SubagentStop and was never
  resumed. A second crashed run's marker was cleared when that agent was resumed and stopped
  normally. So the hook's gap is narrow: **a crashed run that is never resumed leaves its marker
  forever.** The hook belongs to the Overseer and the Mathematician; bring it to them, don't delete
  the file yourself. There's also a dead `2d6ec08b9037.{agents,since}` pair in the same directory,
  pointing at the removed Day 6 worktree root.
- **The undeletable Day 6 worktree folder.** `.claude\worktrees\notemaker-day6-step5-d35669` is an
  empty directory held by another process. `git worktree remove`, `rmdir` and `Remove-Item` all
  failed on Day 7. It's unregistered with git and harmless. Try once more; if it still refuses,
  say so and move on — don't loop.

Standing facts:

- **Firestore rules deploys** must pass `--project notemaker-claude` explicitly. There is still no
  `.firebaserc`, so a bare `npm run rules:deploy` targets whatever project the CLI has active. Any
  deploy (rules or app) is gated on `npm test` and `npm run test:emulator` both passing first.
  `firebase login` credentials are global and already present; nobody needs to log in again.
- `node_modules` in the main checkout is current (`npm ci` on Day 7).
- After step 7: tickets 06 search, 12 back-button, 11 merge. Real PWA icons are still
  placeholders (UI/UX).

## 5. Before you finish

Write the session entry in `.agents/JOURNAL.md`, update the feature files you touched in place
(`Status:` must be true at all times — `verified` means QA ran it), and add to
`.agents/notes/builder.md`, dead ends included. Commit the logbook tagged `docs`. Report the
unpushed range to Badrish by SHA and wait for his word before pushing.
