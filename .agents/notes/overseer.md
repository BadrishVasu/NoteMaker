# Overseer's notebook — NoteMaker

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
