# Mathematician — notebook

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
