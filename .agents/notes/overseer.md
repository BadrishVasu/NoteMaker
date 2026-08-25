# Overseer's notebook — NoteMaker

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
