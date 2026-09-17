# Overseer's notebook — NoteMaker

## 2026-09-17 — Review of the Mathematician's logbook-gate fix (SubagentStart "did not fire" false alarm)

**Verdict: sound. Apply with two small changes.** Nothing under `~/.claude/` touched. Fix is in the
session scratchpad `gate-fix/` (`fix.diff`, `old/`, `new/`, `test.sh`). My extra sequences are in `overseer-check/t.sh`.

### What I checked myself
- `old/` matches the installed hooks byte for byte, so the test compares against what's really installed.
- **Root cause holds.** Reflog: cherry-pick `c8d10b0` 19:40:12, conflicted `41324f1` 19:40:31 (the journal
  was rewritten in between). Main transcript: Stop at 19:40:25 with no error, the Builder's task
  notification at 19:42:26, the FAULT at 19:42:47. The Builder's real entry `ca26496` is at 19:42:01.
- **Claude's diagnosis was wrong.** At 19:43 Claude told Badrish as fact that "a resumed agent fires the
  stop hook but not the start hook". `resume-probe/events.log` shows Start+Stop twice with the same
  `agent_id`. Nobody tested it before saying it. That was the corner cut.
- Re-ran `test.sh`: old 3 WRONG (P1, N1, N3), new 9/9. P1 and N3 flip, and N2/N4/P5b/F1 are the controls
  (they still BLOCK or FAULT). So the tests are real both ways.
- My extra sequences (old / new): O1 parallel runs, entry written while A is still running (FAULT / pass).
  O2 B starts after A's entry and writes nothing (pass, a second silent gap / BLOCK). O3 payload has no
  `agent_id` (FAULT / FAULT: it fails loudly and falls back to old behaviour). O4 incident, then later
  unrecorded work in the same session with `warned` kept (pass / BLOCK).
- `logbook-warn.sh` also reads `.since`. It skips when the journal is newer, so markers that stay put while
  a `.live` exists don't produce false "owing" lines.

### Findings
1. **His stated limit is misattributed.** He says 19:46–19:57 went unflagged because an early block used
   up the warning. The Overseer ran in the foreground, so no early block happened. The FAULT at 19:42:47
   used up `$sid.warned`, which silenced the 19:52:52 Stop. O4 shows the fix would have caught that.
   The limit he describes is real in general, just not what happened this session.
2. **The design history would go stale.** The gate header says `.since` is "created once" and the release
   hook says `.agents` is "append-only". The fix rewrites the first and empties the second. The header
   file list doesn't mention `.live.<agent_id>`. Those headers are the design record, so update them in
   the same change.
3. **Version gap.** The probe ran on `claude` 2.1.241 (PATH). The session runs 2.1.271. Low risk: a
   missing or mismatched `agent_id` either fails loudly (O3) or leaks a `.live` file, which only delays
   clearing the markers. After applying, check once that no `.live.*` files remain when all agents
   are idle.
4. Leaked `.live` files are never cleaned up. That doesn't hurt correctness. Accept it, don't build for it.
5. Remaining limit, not for this change: a main-thread Stop while a background agent is running and
   hasn't written yet still blocks early and uses up the once-per-session warning. Ticket it separately
   if it recurs.

### For next time
- When anyone states a hook or platform behaviour as fact, ask for the probe. This one got to Badrish
  untested.

## 2026-09-17 — Day 6 check: impact of the unmerged Day 5 commits, and step 5 against its brief

**Verdict: on track.** The missed merge cost the record, not the build. The branch is whole again. Step 5
matches Badrish's brief item by item. Nothing is pushed or merged yet.

### What I checked myself
- Refs: `main` = `origin/main` = `302c980`. The only unmerged branch is `claude/notemaker-builder-step-4-7c1d55`
  (`269d3a5`), and its worktree is clean. No stash. `302c980..ca26496` = 7 commits:
  `bc66936`, `cb5e2b6`, `a6121ad` are code/tooling, and `b60d6e1`, `c8d10b0`, `41324f1`, `ca26496` are docs.
- **Whole:** the step-4 branch touched 3 paths (JOURNAL, builder notebook, ticket 03). `git diff 269d3a5 HEAD`
  on those paths is **insertions only** (the Day 6 and Day 6-later entries), with no deletions, so every
  line of the step-4 branch survives unaltered, blank separators included. Ticket 03 is identical.
  `3b442b6` and `c8d10b0` have the same patch-id. Each JOURNAL heading appears once, in newest-first order.
- **Impact:** Day 6 code rests on nothing from the missing commits. `src/domain`, `engine.ts`,
  `remoteGateway.ts`, `fakeGateway.ts`, `architecture.md`, tickets 01 and 02 are untouched in
  `302c980..HEAD`, and the step-4 branch never touched `features/sync-engine.md`. The stale state reached
  three places, all records, and all are now corrected: the Day 6 "still waiting" line (corrected in the
  new entry), `sync-engine.md:201` (corrected in place), and the Day 6 push-range report. That report
  was "empty" against `origin/main`, while two unpushed docs commits sat on the sibling branch. Had
  Badrish green-lit a push from it, the amendment would have been left behind. The Day 5-later
  builder lessons (push by SHA, don't park on a background agent) were missing from his reading, but the
  brief carried both, and Day 6 neither pushed nor parked.
- **Logbook marker Claude called stale:** `.agent-locks/c7007023e3c6.since` = main checkout,
  builder + operations, 16:35:24. That is the Day 4-later session (`904dea6`, 16:35:38), which **is on
  `main` and in the journal**. The main checkout's `JOURNAL.md` mtime is 18:22:10 (the ff to `302c980`), newer
  than the marker, and the warn log stopped listing it as owed from 18:36. So Claude's "journal older than
  16:35 work, living on unmerged branches" is **wrong**. The marker is a leftover that only the Stop gate
  deletes, not a debt.
- **Gate, my own runs:** typecheck 0, lint 0, `npm test` 715/715, `npm run test:emulator` 72/72 (exit 0).
  The wrapper killed a leftover java listener on 8080, and the port was free afterwards.
- **Brief items:** `includeMetadataChanges: true` with empty and non-empty accounts plus the offline
  cases. `complete` comes from `snapshot.docs`, and removals arrive as `doc: null`. `mapPushError` →
  `PermanentPushError`, with a rules denial reaching both gateway and engine as permanent.
  `assertWireDoc` runs on the handed object, with a control, including the Conflict copy. The write-path
  guard has negative controls. Engine clean-sync and conflicting-edits run on the emulator. Rules have
  22 `assertFails` and 15 `assertSucceeds`, the Conflict copy is accepted, and a tenth field is denied.
  Rules are not deployed. The corrections carried forward are intact by construction, because
  engine and domain are unchanged.
- Lockfile churn (+11k/−3k lines): 614 packages added, 0 changed, 0 removed (`firebase-tools`,
  `rules-unit-testing`). Not a drift.
- Not re-run: the 16-mutant claim. Accepted on the record, which names the equivalent survivor and its check.

### Finding for Claude (tooling, not the org)
- The Day 6 worktree's reflog says "Created from **refs/remotes/origin/main**", not local `main`. So
  fast-forwarding local `main` alone does **not** protect the next session: a new worktree still starts
  without unpushed work. Either the push lands first, or the next worktree is cut from `ca26496` (or later).

### Recommended close-out order (Badrish's word needed only for 1)
1. Badrish approves the push of `302c980..ca26496`, or of a later tip if this notebook is committed first.
   Builder pushes by SHA and checks `origin/main`.
2. Main checkout: `git merge --ff-only <pushed tip>` (clean tree, ff possible).
3. Retire `notemaker-builder-step-4-7c1d55`: `git worktree remove`, then `git branch -D`. `-D` is required
   because the cherry-picks changed the hashes. Content was verified above.
4. The stale marker clears itself at the next Stop in the main checkout. Otherwise Claude can delete it.
5. The Day 6 worktree is retired after 1 and 2.

### For next time
- Next session: confirm `git branch --no-merged main` is empty and that the worktree base includes `ca26496`.
- Still open, cosmetic: the "placeholder rules" test title, the `.firebaserc` gitignore comment.
- Mathematician's two follow-ups (date/time hint, epoch-ms test) belong to the editor/UI steps. Check they land.

## 2026-09-17 — Ticket 03 line 118: "missed" on Day 5? No. Done, then stranded on a branch

**Verdict: blocked on the record, not on the work.** The amendment was made on Day 5. It never
reached `main`, so Day 6 started without it.

### What I checked myself
- `git log --all`: `3b442b6` (ticket 03 amended, 18:19:01) and `269d3a5` (the "Day 5, later"
  journal entry, which also records the push and the step 5 prompt, 18:19:29) exist only on
  `claude/notemaker-builder-step-4-7c1d55`. `git branch --contains` names only that branch.
  `origin/main` = `main` = `302c980`. The step 4 worktree is still there at `269d3a5`.
- `269d3a5` quotes Badrish: "push ec664aa..302c980 and amend ticket 03 line 118". So the instruction
  reached the Builder, and he carried out both parts. The amendment's wording is correct: server-backed,
  `fromCache === false`, from `snapshot.docs`, a UI fact only.
- Reflog: the Day 6 worktree was created at 18:22:01 from `302c980`, three minutes after `3b442b6`.
  Its journal, feature file and ticket are all from before the amendment.
- The Day 6 prompt's line "amended on Day 5" was **true**. The Builder wrote it
  (269d3a5: "Step 5 prompt handed to Badrish"). It was not an unchecked assertion.

### Where it failed
1. **Session hand-off (root cause).** Day 5's later commits stayed on a worktree branch that was
   never merged locally. That was correct for the push, which needs Badrish's word, but nothing
   carries unpushed local work into the next session's base. The new worktree branched from
   `main`. Owner: Claude, who creates the session worktrees. Builder shares it, because his
   "Unpushed" line in `269d3a5` named the commits but not the branch they lived on.
2. **The Day 6 Builder didn't reconcile a contradiction.** His brief said "amended". His journal
   said "open". He repeated the journal in his report (JOURNAL Day 6 Open, `features/sync-engine.md:201`)
   and didn't flag that the two disagreed. One `git log --all` would have found `3b442b6`. His push-range
   check at the start also compared only `origin/main` with `HEAD`, which cannot see a sibling branch.
3. **Claude.** Claude relayed both statements without flagging them. Then, while briefing me, Claude
   said "it has not been amended" after checking only this worktree. That is the same single-branch
   blind spot as in 2.

### What stops a repeat (proposed, owners decide)
- Session start: run `git branch --no-merged main` and `git log --all --oneline main..`. Anything
  listed is reported before work begins. This goes next to the push-range check. Owner: Builder.
- A new session's worktree is based on the previous session's tip when that tip is unpushed, or
  that branch is merged into local `main` first. Owner: Claude.
- A brief that contradicts the logbook is raised first, not reported as two separate facts. Owner: Builder.

### Actions for others
- Builder: **cherry-pick `3b442b6`** rather than writing a second wording. Otherwise there are two
  divergent amendments to reconcile later. Carry `269d3a5`'s lost journal entry and builder-notebook entry
  forward. The journal is append-only, so correct the Day 6 "still waiting" line in a new entry.
  Update `features/sync-engine.md:201` in place. Then the stale branch and worktree can be retired.
- Not verified: the text of Claude's Day 6 relay. I only have Claude's account of it.

## 2026-09-17 — Day 4 check, step 3 (`c63921a`, `916507a`, `0cec6ac`)

**Verdict: on track.** Brief honoured point by point. The `commitPush` move is justified. All three
corrections held. Three record findings, none blocking.

### What I checked myself
- vitest 231/231, tsc 0, eslint 0 at HEAD. origin/main = `ec664aa`, and `origin/main..main` has 6 commits (1 code, 5 docs).
- `src/domain/`: no `Date.now`, `new Date`, `performance.now` or `Math.random`. The copy timestamps come from the in-flight `updatedAt`.
- Cell 7: `applySnapshot.test.ts:101` asserts dirty × absent → `[]`, so the row keeps its `baseContent`. `sync.lineage.test.ts:72` runs the trace where that retained value becomes a correct `conflictBase`.
- P-INV: the harness and `noteStore.ts` still call it a row-shape check. Lineage is a separate assertion against content-per-rev in the fixture (`syncHarness.ts:252-260`).
- Gaps A, B and C are named describes with the Mathematician's trace strings as test titles and bodies. Gap C's continuation uses Builder's reading, which the Mathematician confirmed in his own notebook (verdict 2).
- Random walks: 2 deliveries × 2 starts × purge on/off × 400 = 3,200. That matches the journal.
- `commitPush(flight, action, local, server): RowWrite[]` is pure and lives in `domain/reconcile.ts`.
- The Mathematician's two corrections sit in 02 (both places), `architecture.md` and the feature file, each dated and attributed.
- `features/sync-engine.md` `Status: in-progress` is true: the engine and gateway are unbuilt.

### Call on `commitPush` → `domain/`: justified, not drift
The brief required Gaps A/B/C as step-3 regression tests. Those gaps are capture-rule bugs, and the
capture rule runs when a push outcome is applied. Leaving that in `engine.ts` means either no Gap
tests until step 4 or testing the rule through the engine. Moving it keeps `domain/` pure and the
engine thinner. The decision is recorded with its reason. It's a reversible module placement, not a
Mathematician trigger. What it costs is two engine-owned items with no tests. Both are written
down, in the journal Open list and the feature file Open questions. The adopt-view choice
(lastServerState vs transaction read) is 02's defect 1, a correctness item, so step 4 has to land it as a test.

### Findings (owners fix)
1. **`architecture.md` still assigns the capture rule to the engine.** Table rows at lines 154 and 157
   say "`engine.ts`, applying `PushOutcome`", which contradicts the moved decision and line 75 of
   the same file. The record now disagrees with itself. Owner: Designer (doc owner), or Builder with the Designer told.
2. **Push range notation, repeated from Day 3 finding 2.** The pending range was reported as
   `721e875..0cec6ac`. In git that means 5 commits and excludes `721e875`. The correct range is
   `ec664aa..0cec6ac`. The journal lists all six hashes, so the record is right, but the push
   authorisation will be phrased from the range. Second time, so it's a pattern.
   Owner: whoever phrases it (Builder or Claude). Builder should note it in his notebook.
3. **Mutant count.** The journal and the feature file say "nine mutants", but the feature file lists ten.
   Owner: builder, in the next entry.
- Carried from Day 3, still open: Operations' notebook ends 09-01. Operations wasn't run today, so it
  couldn't fix it. Someone has to bring it in.

### Not findings, don't re-raise
- The Mathematician ruled by reasoning, not by re-running the spike (the scripts are gone). His notebook says so plainly.
  The seeded walks plus 9–10 mutants are real empirical backing, so this is proportionate.
- The disagreement was in appendix 3 (commit cells), not the `applySnapshot` table the brief named. Builder
  brought the Mathematician in anyway. That's the right reading of the brief.
- Builder's mutation-script slip (a mutant left on disk) was self-caught and recorded. `mayWriteCopy` at HEAD is the real guard.
- The Mathematician's k=2 lagged-delivery suggestion: the harness has `current` and `queued`, and the journal calls
  `queued` in-order stale delivery. It's marked non-blocking. I didn't verify it covers k=2, so confirm at step 4 if it matters.

### For next time
- Step 4: the adopt-view test and a surfaced `ConflictCopyIdTooLongError` exist. The `LocalNote extends NoteDoc` leak guard lands with `fakeGateway`.
- Check that architecture table rows 154 and 157 were fixed. Check the Operations notebook.

## 2026-09-16 — Day 3 audit, 0e32dce..721e875

**Verdict: on track.** First check since 08-25. That's three weeks and the first real code, which is
too long between checks. My fault, not the org's.

### What I checked myself (not taken from the record)
- tsc 0, lint 0, vitest 119/119 at HEAD.
- `0e32dce` is on origin/main. `9513dde..ec664aa` = 7 commits, so "all seven" matches. `721e875` is local only.
- The public GitHub check-run on `ec664aa` says Cloudflare Pages completed/success at 11:31:25Z.
  started_at == completed_at, so "build started 11:31:25" is really "success posted then". Operations'
  11:30 read still predates it, so Builder's correction stands.
- Feature `Status:` lines are all true. sync-engine is not-started and reconcile doesn't exist, which fits.
- Badrish's brief was honoured: Mathematician sent before code, types verbatim, steps 1-2, step 3 booked.

### Findings handed out (owners fix, I don't)
1. Operations' notebook stops at 09-01, but it worked 09-06 (commit) and 09-16 (push, plus the premature
   live check). Its own dead end is only in Builder's notebook. Owner: operations.
2. The journal says "Pushed exactly `0e32dce..ec664aa`". In git notation that excludes 0e32dce
   (6 commits). The real push was `9513dde..ec664aa`. It matters because Builder's new rule is to
   phrase pushes as ranges. Owner: builder, in the next entry (append-only). Claude's brief has the same slip.
3. Builder broke a gate he set himself. The 09-06 entry says the Mathematician's answer "must land
   before the invariant is pinned in the contract suite". Step 2 pinned it about 20 minutes after sending,
   before the answer came back. The answer confirmed the predicate and the cost was one function, so no harm.
   But db90efa doesn't say the gate was overridden. Owner: builder notebook.
4. The "41 unwritten sessions" count is wrong. The log appends a row every time the hook fires while the
   journal is owed, and it's never pruned. The 6 builder rows on 09-06 came before its 21:24 entry, so
   they're covered. The 35 designer rows cluster 09-01..09-06. There's a real gap on 09-02/03/04:
   designer runs with no journal entry and no commit, and the Designer's "types" notebook entry is
   dated 09-01 and says "owed for five sessions". What those runs did or failed to do isn't written.
   Owner: builder/designer. The hook log growing forever is a tooling matter for Claude.
5. Claude's marked notes to Builder (notebook correction, push-scope ambiguity) stayed inside review.
   Both were record-honesty or Badrish-owned calls, went to Badrish rather than being settled privately,
   and Builder verified with git himself. The only gap is attribution: the journal presents the scope
   catch as Builder's alone. Minor.

### Not a finding, don't re-raise
- My 08-25 "check whether 10 shipped" was answered: live 09-01.
- The Android wording was fixed at source in d6f1a10 with a lesson recorded. I missed it too across six sessions.
- The mutation-testing on step 2 is real evidence. "Red first" can't be checked from git (test and impl
  share a commit). Accept it unless a pattern appears.

### For next time
- Check in at each build step, not each chapter. Step 3 (reconcile) is the one the Mathematician's
  lineage property has to land in as a real test. Confirm Gaps A/B/C exist as named tests.
- Confirm Operations' notebook caught up.

## 2026-08-25 — first check, at the 7-tickets-closed / 0-code line

Read: PHILOSOPHY/CLAUDE/LOGBOOK, JOURNAL, both feature files, designer + ui-ux notebooks,
map, CONTEXT, tickets 01–12. Designer (architecture) and Builder (readiness) were in flight;
I checked direction only, not their output. Ticket 05 was being edited as I read it
(`.tmp` file present) — some of the staleness below may already be closing.

**Verdict: on track on quality, drifting on sequence.**

### What I checked and found sound
- Depth on 01/02/03/05 is proportionate, not specification for its own sake. 02 caught real
  data loss by model-checking; 03 closed 01's index deferral and killed the watermark trap;
  05 deleted a whole class of dishonest UI ("Offline" badge). Each closed ticket removed work
  or removed a bug. That is the test I applied, and they pass it.
- TDD has real room: `NoteStore` port + fake, `applySnapshot` and `reconcile` as pure units,
  emulator confined to rules and transaction semantics, and 09 owns the "no `setDoc` on a Note"
  guard. Plans do not assume TDD, they seat it.
- Mathematician consultation: correctly spent on 02. I found no *other* call of that weight
  made alone. 03's whole-corpus-in-memory is scale-relevant but reversible (`persistentLocalCache`)
  and the Designer said so. Not worth a consult.

### Findings (detail in the report to Badrish)
1. **Sequence drift.** Ticket 10 (deploy) has been open and unblocked since 04 closed. It is the
   only open ticket that produces a running artifact; 06/09/11/12 are all further specification.
   The map says the destination is *running, not specified*. Nothing deploys.
2. **Un-owned irreversible decision.** `autoUpdate` vs `prompt` (ticket 07): research says pick
   before first deploy, switching later is problematic. No open ticket owns it. 10's question
   does not mention it. This is the one call that gets locked by the first deploy and nobody holds it.
3. **Record out of sync with its own ticket.** 05 records that Badrish *rejected* the Write/Read
   toggle (preview is an invoked action, no split-pane). map.md:104 and
   `features/editor-and-shell.md` still list the toggle as a decision, and the feature file still
   lists the resolved split-pane question as open. LOGBOOK says feature files must be true at all times.
4. **Dangling Badrish request.** 05 line 89 points the manual-save option at a section
   "Open with Badrish" that does not exist in the file. His request currently has no home and no owner.
5. **No feature file for the sync/conflict mechanism** — the most load-bearing feature in the
   project, closed and model-checked, has no `features/` entry. 03 and 05 have one.
6. **Scope, for Badrish only.** Ticket 11's per-hunk merge UI is the largest single surface in the
   app, serving an event a one-user/two-device setup hits rarely. Its own ticket offers a
   pick-a-side variant at a tenth of the cost. Not mine to cut — flagged to him, ranked below "running".
7. Logbook and prototypes are all untracked in git. The record is supposed to travel with the code.

### Accepted gap I want on record (not a finding, a thing to not forget)
03 knowingly accepts one **silent** loss path: same Note typed in two tabs on one device is
last-save-wins with no Conflict copy. CONTEXT.md's Conflict copy definition says a write is never
silently lost. Cross-device is fully preserved; this is the same-device axis only, self-inflicted,
and the fix is real machinery. I agree with leaving it. It should not be discovered later as a bug —
it is a decision.

### For next time
Check whether 10 shipped before 06/12 closed. If a third specification ticket closes with nothing
deployed, escalate rather than flag.
