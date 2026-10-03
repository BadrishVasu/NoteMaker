# Mathematician — notebook

## 2026-10-03 — NoteMaker, 03 read cost: Badrish's "cache for recent/frequent notes" (/deduce)

Badrish refused the binary Builder put to him (leave it, or flip `persistentLocalCache`) and asked
for the access pattern to be solved from. Ran `/deduce`. Full decision is in **03's 2026-10-03
amendment**; `architecture.md` carries the one code rule it forces. Designer ratified A/B/C
in one pass (his entry, same date). What follows is only what I would want to re-read.

**The basis change that did the work.** "Local storage for recent/frequent notes" is unbuildable as
stated — 06's search, Trash and the offline promise each require the *whole* corpus locally, and
the footprint was never the cost anyway. Recency can only change *what we re-validate and when*.
Once that is said, every candidate collapses to one variable: **the schedule and scope of the
full-collection subscription.** Builder's framing was right and I told him so.

**The fact that decided it, and that I had wrong going in.** `persistentLocalCache` is *not*
"reads ≈ 0". Firestore's own pricing page: a listen resumed from a token more than 30 minutes old
is billed as a brand-new query. So the unit of cost is not the open, it is the **usage episode** —
`E·N` with E ≈ 6–12, not `D·N` with D = 20–50. Android's 50 opens/day are ~8 visits the OS chopped
up, and the saving is exactly that clustering. Which means **the saving is empirical, not
guaranteed**: a user who opens once an hour all day gets nothing. Booked as the one open question,
checkable by dividing the console's reads/day by N.

**The argument that eliminated everything else, in one line:** `persistentLocalCache` is the only
candidate that preserves `batch.complete`. The first server-backed snapshot is still built from
the full `snapshot.docs`, so the known-but-absent rule, the stamp and `lastServerState` are
untouched and only the delta is billed. Every watermark or partial-subscription scheme kills
completeness, and with it the mirror's convergence on deletions. Builder named completeness as the
crux and he was right — it is the crux, and it is what *rules out* the clever options rather than
needing to be redefined for them.

**The defect I found, which is the only real work this creates.** Today `applyBatch` applies the
content of from-cache batches, and that has never mattered because under memory cache the
pre-complete from-cache batch is always *empty*. With a persistent cache it is populated and can be
arbitrarily stale relative to our mirror → clean rows walk backwards, visibly, and offline they
stay that way. The drop goes **in the gateway**, not in `applyBatch` (Designer's placement, and he
is right: adding a condition to the model-checked function is the expensive way to be correct).
It is lossless *because* the complete batch is `snapshot.docs`. Do not widen it to all from-cache
batches — post-sync catch-up deliveries arrive from-cache with real updates.

**On Builder's question about removals and ticket 13.** The "a filtered query never delivers
removals" objection does dissolve *today* — nothing is hard-deleted. I did not let it carry,
because a watermark is permanent and 13 lands a hard delete on top of it, and because a second,
non-dissolving objection exists (no complete batch, ever). Worth remembering as a pattern: when an
objection dissolves, look for the one underneath it before changing the answer.

**The thing I nearly over-engineered.** The hot-set scheme is genuinely cheaper on paper
(`D·|hot| + s·N` beats `E·N` above ~150 Notes) and it is literally what Badrish described. It dies
on its worst case being *worse than the baseline* — and Badrish's own workload description
(day-to-day lists, long-running task notes, journals revisited as life happens) is precisely a hot
set that is most of the corpus. Also: the Spark cap is an availability cliff, and 25k reads/day on
Blaze is ~$0.22/month. The engineering alternative to a one-line change was worth a quarter a
month. Say that out loud before building anything.

### Dead ends — do not re-walk
- Throttled full re-subscribe on memory cache. At T = 30 min it is arithmetically identical to
  `persistentLocalCache` with worse freshness; at T = 4 h it is ~1.7× better and four hours stale.
- `serverSeq` watermark. Tenth field in 01's closed allowlist + rules change + model check, to buy
  "≈0" over "N per 30-min gap", forfeiting removals *and* completeness.
- Hot-set-only subscription (as a replacement). Worst case = baseline; breaks `batch.complete` as
  the source of the absence rule. Still fine as an *addition* on top of the persistent cache.
- `persistentMultipleTabManager`. firebase-js-sdk #10410: a new primary re-listens with a stale
  persisted resume token and re-bills every query — the opposite of the point. Single-tab manager;
  a second tab degrades to today's behaviour with no correctness impact.
- Clearing the SDK cache on sign-out. `clearIndexedDbPersistence()` needs `terminate()` first, and
  it would delete the resume token this change exists to create while leaving the mirror.
- Reading `readCost.emulator.test.ts` as a live cost measurement after the flip. Documents
  *delivered* stops being a proxy for documents *billed*; the number is on the console now.

## 2026-09-21 — NoteMaker, review of the built 02 amendment (Builder, Day 8)

Reviewed the uncommitted working tree: `domain/edit.ts`, `app/saveNote.ts`, `AppShell.tsx`, and the
engine's emission and lock. `bufferEdit`, the FIFO `createExclusive`, in-section publish and
redirect, `redirectTarget`, and the re-keying all match rules 2-4. I found two defects.

- **Builder's `redirected` alias is right for a stale keystroke and wrong for everything else.**
  `seed` resolves through it, so reopening `from` later puts `base := row(from)` under key `to`. The
  commits then land at `to`: a concurrent branch that spreads `from`'s `conflictOf`/`conflictBase`
  onto the copy. If `to` is dirty or queued, `seed` is refused, the buffer at `to` takes A's body,
  and an ordinary commit makes a clean overwrite of the copy on the server. That is our conflicted
  text lost (P1). You don't need a race to reach it: any Note opened earlier this session that
  conflicts later is affected. **Rule:** an alias names the edit stream that was open at redirect
  time, not the Note id. `seed(row)` never resolves, and it drops the `row.id` key. On a redirect,
  repoint every alias whose value is `from` to `to`, so lookups are single-hop. Chains then work,
  and a re-seeded middle link doesn't redirect anyone. The clean form is seed returning a stream
  handle, which removes the map. I held that back as optional because it's more invasive.
- **Reseed runs in a passive effect.** `reseed` moves base and buffer. Then the remount happens in a
  later render, and in between there is a task boundary where the old textarea is live. A keystroke
  in that window gives buffer = old text on the new base. `sameVisible` holds, so it's an ordinary
  edit, which is a clean overwrite of the other device's edit. That is P1b broken. It's the same
  class as step 6's focus race. **Fix:** make the reseed effect `useLayoutEffect`, so the
  mutation and the remount commit happen in one task.

Dead end: "remove the alias, drop the lazy seed". A stale keystroke then either drops (loss) or
lazily seeds from the adopted row (overwrite). The alias is needed. Only its scope was wrong.

Lock markers: `a4873fc2646d5815d` (Sep 18) is dead. Its only effect is that `logbook-gate` never
discharges `.since`/`.agents` for that project, and the hook documents that as benign. The
`2d6ec08b9037` pair is already gone. Ruling: delete by hand. The hook change is a 24 h staleness
bound on `.live.*` in the gate. This is the second leak, so it's worth doing. It is Badrish's call,
because a >24 h run would only get an early discharge.

## 2026-09-21 — NoteMaker, step 7 gate: the editor buffer vs. the mirror (Builder's issues 1–3)

Builder was asked about a redirect landing mid-save, and found that the problem is wider than that.
He was right on all three counts. Ruling is in 02 as "Amendment, 2026-09-21 — the editor buffer is a
dirty row".

- **Issue 1, real and the worst of them.** I confirmed it with a throwaway vitest spike against the
  real `applySnapshot`/`recordEdit`/`beginPush`/`decide`, then deleted it. Clean row R0, debounce
  pending, adopt S (cell 6), flush: `decide` gives `write/clean`, which overwrites B silently. Under
  the buffer rule it gives `conflictCopy`. It is reachable whenever two devices type online at once,
  including continuous typing after our own clean push cleans the row. The redirect variant is the
  same bug: `from` is clean at the server rev after migration.
- **Issue 2, real.** An uncontrolled textarea sends its whole body. The row's display can move under
  it, and nothing tracks the buffer's base.
- **Issue 3, real.** The IDB readwrite transactions serialise, but `commitEdit` reads the corpus
  *outside* its transaction. An engine transaction created before the put, whose result is not yet
  in the corpus, gets reverted by a put built from the stale row. That produces a spurious copy of
  our own text.
- **Same shape, not in the brief:** Delete after a remote adopt clean-deletes the other device's
  body into a tombstone. A remote trash during the debounce is silently restored by the pending
  patch (`deletedAt: null` from the stale base). `writeNow`'s `row === undefined → return` drops
  the keystrokes.

**Rule, in one sentence:** 02's snapshot guard lifted to the buffer. The queue holds `buffer` and
`base`. `base` moves only on editor seed, own commit, or redirect. The edit commit reads in-tx: if
`sameVisible(r, base)` it is an ordinary `recordEdit(r)`, otherwise `recordEdit(base-as-clean-at-base.rev)`.
There is one writer mutex over all mirror writes, and it publishes to the corpus and emits the
redirect inside the section. The redirect fires iff `commitPush` put a row at `copyId`. Soundness in
one line: the clean branch needs `srv.rev === base.rev`, and the buffer descends from `base.rev`.

### Dead ends, do not re-walk
- **(d) mirror write per keystroke, no debounce.** It doesn't close the hole, because IDB is async
  and an adopt transaction can order before the put. It also leaves issue 2 untouched, and it costs
  a write, a corpus notify and a push wake per keystroke. Once the base check exists, the debounce is
  harmless.
- **Discriminating on rev equality (`r.rev === base.rev`).** It is sound, but a fast-forward adopt
  (same content, new rev) then produces a spurious copy. Content equality (`sameVisible`) is sound
  too, because P1b is about content lineage, and it has no spurious case.
- **Using base's own lineage (`recordEdit(base)` when base is dirty at T with baseRev R) for the
  concurrent write.** It is sound, but base's lineage goes stale once the engine cleans T. In
  single-tab, concurrent-with-dirty-base implies T landed, so `baseRev := T` is the nearest fork
  point. Builder's candidate (b) was right on this.
- **The queue searching for where its rev went (`conflictCopyId(from, dev, ?)`).** The copy id is
  keyed by *flightRev*, not by the queue's last rev, so it can't be found without the flight history.
  Use an explicit redirect event, ordered by the mutex.
- **Fixing two tabs typing into one Note here.** That is 03's accepted last-save-wins (Overseer has
  it on record). The concurrent branch keeps exactly today's behaviour for it.

Open: the re-seed of a clean buffer on remote adopt is UI/UX's call. Without it, every first
keystroke after a remote edit on an idle open Note makes a (correct) Conflict copy. That is a real
UX cost in the "same note, one device at a time" workflow, so I recommended re-seeding.

## 2026-09-17 — Global logbook hooks: the "SubagentStart did not fire" false alarm

Asked by the Overseer via Claude (Badrish's request). Subject is `~/.claude/hooks/`, not NoteMaker
code; recorded here because it fired in this worktree. Nothing under `~/.claude/` edited; the
change is a proposed diff awaiting Badrish.

**Root cause (high confidence, from the session transcript and builder sidechain):** the gate
discharged the markers while the resumed Builder was still running in the background. At 19:40:19
the Builder's `git cherry-pick 269d3a5` hit a conflict and rewrote JOURNAL.md with conflict markers.
At 19:40:25 the main thread's turn ended and Stop fired. Since journal -nt .since, the gate deleted
both markers. The Builder kept working, wrote its real entry at 19:41:43, and SubagentStop at
19:42:24 created a fresh `.agents` with no `.since`. At the next Stop, 19:42:47, the gate reported a
hook fault. The same interleaving happened again at 19:58:52 (resume), 19:58:54 (discharging Stop)
and 19:59:37 (Stop), which accounts for the 89-byte builder-only `.agents` left behind.

**Dead end: "a resume fires SubagentStop without SubagentStart."** This is false. I checked it with
a headless `claude -p` probe (2.1.241) that used scratchpad-local logging hooks. A foreground spawn
followed by a SendMessage resume logged Start/Stop, then PostToolUse(SendMessage), then Start/Stop
again with the **same agent_id**. In both incidents the resume's Start came before the discharging
Stop, so a Start firing on resume could not have prevented the bug.

**Pre-existing hole found (worse than the false alarm):** suppose a run ends and is resumed in the
same main turn, with no Stop in between. The resume's Start sees `.since` already present and
doesn't touch it. If the resumed work writes nothing, the old entry still makes journal -nt .since
true, and the gate passes silently.

**Fix (3 hunks, diff in my reply to the Overseer):**
1. confirm.sh: roll `.since` forward, and truncate `.agents`, when journal -nt .since at Start.
   Also touch `<pkey>.live.<agent_id>`.
2. release.sh: remove `<pkey>.live.<agent_id>`.
3. gate: don't discharge while any `.live.*` exists.
A leaked live marker only delays deletion, because the next Start rolls `.since` anyway. I did not
add a timeout, which follows reset.sh's "no ageing out" rule.

**Rejected:**
- Recreating `.since` at SubagentStop when it's missing. That's the stated constraint: the entry
  comes before the Stop marker, so honest sessions get flagged.
- Recording the settle time and restoring `.since` from it. This gives false flags when the main
  Stop lands between an agent's entry and its SubagentStop, which is a common window.
- Deferring the gate's block, not just its discharge, while an agent is live. A leaked live marker
  would then silence the gate for good.

**Tests:** 9 scenarios in `scratchpad/gate-fix/test.sh`, using `touch -d` time control. On the old
hooks, P1 (the incident) gives FAULT and N3 (same-turn resume that writes nothing) gives a silent
pass. On the patched hooks all 9 are correct, including the negative controls N2, N3, N4 and P5b.

**Known limits, not fixed:**
- mtime can't distinguish a conflict-marker write from an entry (N1). This matches the design's
  per-stretch rule.
- A main Stop while a live agent hasn't written yet still blocks mid-run, and it spends the
  once-per-session `.warned`. This session's false alarm spent it too, so the real 19:46–19:57
  overseer debt went unannounced.

## 2026-09-17 — NoteMaker, step 5: odds of an honest device breaking the 1-day `updatedAt` bound

Reasoned from code (`firestore.rules:27`, `edit.ts`, `conflictCopy.ts:48-49`, `reconcile.ts:153`,
`engine.ts:91,263`). No spike; nothing to model.

**Invariant that settles the mechanism question:** every `updatedAt` we push is a device wall-clock
reading taken at or before the push — stamped at edit, or copied verbatim from an earlier stamp
(Conflict copy takes the flight's; migration keeps `cur.updatedAt`; adopted rows keep the server's,
which already passed the rule at an earlier `request.time`). `request.time` only grows. So
`updatedAt − request.time ≤ device skew at the moment of the edit`. Delay (offline days, late
re-push, retry) only shrinks the excess. **Denial ⇔ the clock was >24 h fast when the edit was made.**
Nothing in our mechanism can produce it with a correct clock.

- Assumed, flagged: the (unbuilt) UI stamps with `Date.now()` in **milliseconds**. A µs/ns stamp
  would break every push; seconds would silently pass. One test on the UI caller covers it.
- Timezone errors cannot cause it (epoch millis are zone-free) except a manually-set clock with the
  wrong zone, max offset ~26 h (UTC−12 vs UTC+14) — practically nil.
- Dead RTC / GPS rollover / bad NTP push clocks into the PAST (no lower bound → harmless).
- Real cause: a person setting the date forward by hand (game timers, trial extension, testing).
  Those jumps are days-to-years, so the distribution is heavy-tailed: widening 1 d → 7 d buys little.
- Odds: my estimate, not measured — ~1 in 1,000 to 1 in 10,000 devices at any moment, mostly
  deliberate. Confident in "rare and deliberate", not in the digit.
- Heals itself: `stuck` is in-memory, so the next app open retries; it passes once real time is
  within a day of the stamp, or on any edit after the clock is fixed. Exposure while parked: that
  Note is on one device only.

Recommendation: keep the bound. One cheap change: the permanent-failure message should name the
device date/time as a likely cause (gateway can't tell this denial from others).

### Dead ends — do not re-walk
- "Late push after days offline could trip it": backwards — lateness makes the stamp look older.
- Client-side clamp against server time: no server clock available without a round-trip; not worth it.

## 2026-09-17 — NoteMaker, step 4: engine sequencing rulings (Q1–Q4)

Reasoned, not model-checked — no spike this time. Rulings given to Builder:

1. **Q1 adopt view at commit time: correct.** Defect 1's safety argument ("map behind ⇒ a delivery
   follows") holds at whatever instant the map is read, provided map read + row writes are atomic
   against snapshot applies (his mutex). A beginPush-time view is strictly staler. Discriminator is
   read in the same critical section.
2. **Q2: the hole is real (display, not data), but the gate is the wrong fix.** Discriminator must
   be an in-memory `sessionComplete` flag ("this listener subscription has applied a complete
   batch"), NOT persisted `initialSyncCompletedAt`. Before it, adopt from the transaction read — safe
   because the first complete batch is still to come and corrects any row. No push gate, no
   first-ever exception. Reset flag + clear map on resubscribe/sign-out. `initialSyncCompletedAt`
   stays a UI fact. Adopt-deletes pre-batch lose no data (walked all four adopt paths: content is on
   server, in a copy, superseded by a descendant, or a lost delete by design).
3. **Missed by everyone so far: `fromCache`.** Offline at open, the listener fires an EMPTY
   snapshot with `metadata.fromCache === true` even on `memoryLocalCache`. Treated as "first batch
   is complete" it deletes every clean row (cell 3) and stamps `initialSyncCompletedAt`. Completeness
   = first batch with `fromCache === false`, needs `includeMetadataChanges: true`, and must be
   processed against the full `snapshot.docs`, not `docChanges` (changes are relative to the prior
   cached snapshot and can omit docs). Backoff reset / connectivity oracle likewise server-only.
4. **Q3 hold the gate on timeout: correct.** Builder's trace is real. Releasing puts two flights of
   one (device, Note) concurrent — outside the checked model. Hand-walked both commit orders: spurious
   copies (incl. a copy of STALE text when the late flight re-runs after the newer one lands), no loss
   found — but unverified, so don't go there. Late success committed normally is right (Gap A/B
   covers typing). Cost: a truly wedged runTransaction pins one Note for the session; accept.
   Note: lost-response + typing already yields a spurious copy inside the model — same class.
5. **Q4 terminates**: every success either cleans the row or leaves it dirty only under a changed
   pendingRev, except conflictCopy typed&&!free → [], whose next flight is !typed and adopts. ≤2
   pushes per edit burst. Real problems: global backoff reset-on-any-success hot-loops a Note with a
   PERMANENT error (permission-denied, invalid-argument e.g. >1 MiB doc) — classify like the id-length
   error; and immediate re-drain = one transaction per RTT under continuous typing unless edits are
   debounced upstream.

**Status:** all built by Builder in 5343d58 (port `SnapshotBatch {fromCache, complete, changes}`,
generation guard on resubscribe, no backoff armed at timeout, permanent errors parked). 02 Defect 1
correction folded in by me, uncommitted, as a second dated block after the first. 03 line 118 is a
grilling record: Builder is taking its amendment to Badrish, not edited. Still open: the
architecture.md / sync-engine.md / reconcile.ts wording below.

02 text to change (02 now DONE): Defect 1 "falling back … while `initialSyncCompletedAt` is unset" and "rebuilds
from the first snapshot before any push can matter" → the session flag + fromCache rule. Same
phrase in architecture.md (~45, 137, 691), sync-engine.md (~125), reconcile.ts commitPush doc.

### Dead ends — do not re-walk
- Gating push start on first batch: sound but unnecessary once the discriminator is per-session;
  it also delays pending edits at open by the whole corpus download.
- Safe gate release via "treat abandoned flightRevs as base": fixes flight2's copy, but the late
  flight1 re-run then reads R2 and writes a spurious copy of stale text. No cheap safe release;
  `terminate()` doesn't give one either (commit RPC may already be on the wire = lost response).

## 2026-09-17 — NoteMaker, step 3 review: Builder's commitPush cells vs appendix 3

Spike scripts (`model.js`, `basecontent.js`) are **gone** from the scratchpad — checked by
reasoning against the appendix and Builder's harness, not re-run. Verdicts:

1. **My appendix-3 sentence was wrong, the code is right.** Migrated copy row: `baseRev := flightRev`
   so `baseContent := content at flightRev` = the copy doc's *content*, NOT its `conflictBase`
   (that is noteId's fork point, content at the flight's baseRev). Lineage forces it. Ticket 02
   text needs correcting.
2. **Gap C continuation as written is not executable** (second `cpush(1,N)` with nothing in
   flight). It forks before the first cpush. Builder's 11-step reading is the trace.
3. a–g all agree. Notes worth keeping:
   - 3a: row clean at commit under `conflictCopy` is reachable only with stale (k=2) delivery:
     create/lose, other device overwrites, retry conflicts, stale cell 9 cleans. `[]` is right;
     the copy is spurious, not lost, and arrives by listener.
   - 3b: migrating onto a superseded or dirty copy row clobbers local content. Literal reading is right.
   - 3c: the eager insert can leave a ghost clean copy row if the copy is purged AND delivered
     absent between decide and commit. Real purge only takes aged tombstones, so this is the
     already-accepted purge-race class, healed by 03's reopen re-read. Kept, not guarded.
   - 3f: the 5-field `lastServerState` was MY defect-1 spec (02 line ~331) and it was a defect:
     adopting a copy would drop conflictBase, and the next clean push (`toNoteDoc`) erases it
     server-side. Whole NoteDoc is required.
- Recommended, not blocking: an in-order lagged delivery mode (k=2) in `syncHarness`.

## 2026-09-06 — NoteMaker, `baseContent` capture points (ticket 02, third appendix)

Builder sent the designer 2026-09-01 `baseContent` claim rather than building on it. Right call
again: **the two stated capture points are insufficient — three gaps.** Full write-up is 02
appendix 3. The one-line result:

> `baseContent := the in-flight content` at **every** point where `baseRev := flightRev` and the
> row stays dirty; `null` at every point where the row goes clean.

The designer stated that only for the clean-push branch. It also has to fire on **already-landed**
(retry/lost response/second tab), on **recreate-into-an-absent-doc**, on the **first landing of an
unlanded create**, and — the expensive one — on the **conflict-branch outbox-slot migration**, which
his rules do not mention at all. Gap C writes a genuinely stale `conflictBase` to the server on a
copy-of-a-copy. That field is unretrofittable, so this was worth the run.

### Dead ends and things now ruled out — do not re-walk these

- **The biconditional `baseContent !== null ⟺ pendingRev !== null && baseRev !== null` is not the
  property.** It is implied by the corrected rule and worth pinning, but it is a *shape* check. Run
  against the Gap-C design it survived 466k and 897k states without firing, while the lineage
  property failed at depth 6. Any time an invariant is expressible as a null-pattern over columns,
  ask what it does *not* constrain — here, the value itself. Same shape as the P1b lesson from
  2026-08-25: set membership vs. lineage, again.
- **No `applySnapshot` cell needs a `baseContent` capture.** Builder suspected a dirty-row-adopting
  cell. There is exactly one (cell 9) and it clears dirty, so `null` covers it. Checked, not
  reasoned.
- **Cell 7 (doc absent, dirty row) retaining `baseContent` is correct, not a leak.** The fork-point
  content is a fact about a *rev*, not about the live document; purging the document does not
  invalidate it. The model reaches the trace where that retained value is later written as a real
  `conflictBase` after a recreate, and it is right there. Do not "clean it up".
- **`baseRev === null` really is the only absent-`conflictBase` case** (checked as `P-ABS`). But the
  reachable shape is not "an offline create conflicts" — that is impossible, an absent doc with
  `baseRev === null` is an ordinary create. It is: our create lands, **the response is lost**, the
  other device edits, our retry conflicts with `baseRev` still null. Anyone re-deriving this will
  get the wrong story without `lose-response` in the alphabet.

### The spike

Throwaway, not committed, session scratchpad as `basecontent.js`. Focused model — not the full 02
model; it drops P1/P2/P4 and checks only the `baseContent` family, which is why it is ~1.6M states
at depth 11 instead of depth 9. Canonicalises states by renaming rev/content tokens in order of
first appearance and GCs `revContent` to reachable revs; that renaming is what buys the extra depth
and is worth reusing on the next 02 question. Flags: `CAP` (`general` | `designer` | `nocap2` |
`nomigrate`), `START` (`landed` | `create`), `K`, `PURGE`, `D`, `ONLY`, `STOP`.

**Three negative controls, each removing one clause and each failing** — recorded because the
project has been burned once by a check that tested nothing, and because "0 violations" is
worthless without them. Coverage counters on every transaction branch and every snapshot cell, for
the same reason: at depth 9 the assertion site is reached 5,294 times.

## 2026-08-25 — NoteMaker, ticket 02 re-verified with snapshots

Builder caught a real gap: my original ticket 02 model had four event kinds and no
`snapshot-delivered`, so the second trap in the ticket was reasoned, not checked. He was right to
refuse to build on it. Extended the model (snapshot delivery through a coalescing FIFO queue,
`lose-response`, `purge`), exhaustive to depth 8 across four configurations and depth 9 on the
recommended one. **Three defects**, all appended to ticket 02:

1. `commit` adopting the transaction read instead of the listener's view — permanent divergence.
2. The deterministic copy id plus the `updatedAt !== createdAt` pristine guard — data loss.
3. The outbox-slot migration guard testing only "is the copy row dirty" — data loss.

**Lesson, and the reason the gap was findable at all: a ticket that claims "model-checked" must
list the event alphabet.** Mine did. Keep doing that, and name the spike's config flags in the
ticket so the variants can be re-run by whoever comes next.

### Dead ends and things already ruled out — do not re-walk these

- **P1b as "the writer had observed that rev" is too weak.** It passes on the exact traces that
  lose data. The property has to be *the writer's content must be descended from the content it
  destroys* — a lineage check, not set membership. Every real defect came out of that one
  strengthening; nothing came out of the weaker form.
- **"A snapshot must never advance `baseRev`" taken literally breaks sync.** It is a dirty-row
  rule only. The general invariant: `baseRev` may only be set to a listener-delivered rev on a
  clean row, or to a rev this device itself wrote.
- **Letting the push path own the dirty→clean transition alone** (snapshot ignores
  `rev === pendingRev`) is *safe* — it passes every property at depth 8 under both queue depths.
  Rejected on quality: it produces a spurious Conflict copy on the lost-response path. Do not
  reopen this as a safety question; it is not one.
- **Keying the copy id by note+device with a pristine guard** loses data, and both halves are
  wrong: the guard tests the wrong thing, and coalescing across two *independent* conflicts is
  unsound because the lineage forks at slot migration. Fixed by deriving id *and* rev from the
  flight token, which also deletes the guard.
- **Testing only `pendingRev !== null` to decide whether the migration target is free** is not
  enough. A clean copy row sitting at some *other* `baseRev` still holds content that is not ours.
  This one passed at depth 7 and only failed at depth 8 — depth 7 was not enough for this design.
- **Adding an `awaitingRev` column to the mirror row** to close the transaction-read regression:
  considered, rejected. An in-memory `lastServerState` map does the same job, needs no IndexedDB
  column, and 03's full-corpus re-read on every app open rebuilds it for free.
- **Making `conflictOf` referentially sound**: impossible, and not worth trying. It dangles
  whenever the surviving sibling is purged, regardless of any decision we make. Soft pointer; the
  UI tolerates a missing target.
- **P4 as a global invariant ("no dangling `conflictOf` anywhere, ever")** is unachievable for the
  same reason. It only bites as a *creation-time* check, and in that form it cleanly kills the
  "recreate as a Conflict copy" option for a purged note.
- A **purge racing a push** strands one device on a stale clean row until the next app open. Not
  fixable from the client without machinery; 03's no-resume-token full re-read is what heals it,
  so the convergence check has an explicit app-reopen step. If anyone ever turns
  `persistentLocalCache` back on per 03's tripwire, **this corner has to be re-verified** — that
  reopen step is doing real work.

### The spike

Throwaway, not committed, in the session scratchpad as `model.js`. Config flags: `SNAP`
(`clear` | `ignore`), `ABSENT` (`recreate` | `copy`), `COPYID` (`idem` | `revkeyed` | `pristine`),
`STALE` (`0` = coalesce-only, else in-order stale delivery), `D` (depth). `TRACE='ev -> ev -> …'`
replays a single trace and dumps the pre- and post-settle state, which is how every one of these
was diagnosed. Recommended config, and the one that holds: `SNAP=clear ABSENT=recreate
COPYID=idem`.
