# Designer's notebook — NoteMaker

## 2026-08-25 — ticket 03, the local store

First session on this project. Read 02 in full before deciding anything; it is the constraint that
matters and it is unusually well argued. Ratified its handed-down answer, but not its reason — see
below.

### Where I disagreed with the inherited reasoning

02 and the map both justify the memory-only cache with "keeping clean Notes in the SDK cache and
dirty Notes in ours is the two-stores-disagreeing failure." I don't think that's true. Two stores
only disagree if something reads both. Nothing reads the SDK cache in this design — the UI reads our
mirror, `onSnapshot` feeds it, `runTransaction` drains it. The SDK cache would be a private
implementation detail of the transport.

I kept the conclusion because there are three reasons that do hold (duplicate corpus on disk for
only a resume token, blast radius of a stray `setDoc`, no multi-tab cache manager), and because
reversing it is one line. But I wrote the correction into the ticket. A right answer resting on a
wrong reason gets reversed for a wrong reason later.

Related correction I want on record: **memory cache does not prevent offline write queueing.** The
mutation queue exists with memory cache too; it's just in-memory and dies with the tab. Only
`runTransaction` prevents queueing. If anyone starts treating the cache setting as the safety
mechanism, ticket 09's "no `setDoc` on a Note" test is the actual one.

### Dead ends, ruled out — do not revisit

- **`where('updatedAt', '>', lastSeen)` to avoid the full re-read per app open.** This is the
  single most tempting optimisation in the whole design and it is a data-loss bug. It is exactly the
  Sync watermark 02 cut from CONTEXT.md. Under client clocks (ticket 01), a device with a lagging
  clock writes an `updatedAt` below our watermark and that Note is *never* delivered again. Silent
  and permanent, to save reads we are nowhere near the quota on. If read cost ever bites, the answer
  is `persistentLocalCache`, not a watermark.
  **Amended 2026-08-26 — read the whole entry before reusing it.** Badrish asked why the base clock
  can't be the server's, and that objection *only* holds for client clocks. See the notebook entry
  dated 2026-08-26 below and ticket 03's amendment; the watermark is still not adopted, but the
  reason changed, and quoting the sentence above at someone who proposes a server-stamped field is
  answering a question they didn't ask.
- **Dexie.** Reflexive choice, and wrong here. Its value is queries and compound indexes; we issue
  zero queries because the whole corpus is in memory. 25 kB of query engine for a `getAll`.
- **A separate `outbox` object store.** Would make "record the edit and enter the Outbox" two writes
  in two stores that must agree — the same failure this ticket exists to avoid, one level down.
  `pendingRev !== null` is the dirty flag; one row, one atomic put. Also matches CONTEXT.md, which
  defines Outbox as a *set of Notes*.
- **A `synced` boolean alongside `pendingRev`.** Two fields encoding one fact, guaranteed to drift.
- **Web Locks leader election for cross-tab.** 02 already relieved it of correctness duty. Its only
  remaining benefit is halving reads for a two-tab user. BroadcastChannel invalidation is ~15 lines
  with no failure mode (a dropped message just leaves a tab stale until the next snapshot).

### Things I nearly missed and want the next agent to hold onto

- **`navigator.storage.persist()`.** Unpushed Outbox edits live *only* in the mirror. Default
  IndexedDB is best-effort and evictable under disk pressure. Without the persist call, "offline
  edits are durable" is "offline edits are probably durable." One line, big difference. Chrome
  weighs PWA install + engagement, both of which we have.
- **`initialSyncCompletedAt`.** Empty mirror means two completely different things (still
  downloading vs. genuinely no Notes) and without this flag a new device shows the first-run welcome
  screen over a corpus that is mid-download. Cheap now, embarrassing later.
- Whole-corpus-in-memory quietly satisfies ticket 01's `Untitled Note N` rule ("highest N in the
  local mirror") — that rule is only implementable if the mirror is fully loaded before a Note can
  be created. Worth knowing the two decisions are coupled.

### Accepted gap I'd revisit if it ever bites

Same Note open in two tabs, typed in both → last-save-wins, **no Conflict copy**, because it's one
mirror row and one Outbox slot. Cross-device conflicts are fully preserved; this same-device one
isn't. Fixing it means per-Note locking or treating tabs as devices. Self-inflicted scenario, real
machinery. Left it.

### 2026-08-25, later — the architecture

Wrote `.scratch/notes-mvp/architecture.md` after reading 01–05 and 07–08 myself. The load-bearing
call, and the one to defend if it's challenged: **`RemoteGateway.runPush(uid, noteId, decide)`,
where `decide` is 02's pure reconcile.** Everything good downstream comes from that shape — ticket
09's second device becomes a second engine instance instead of a second browser, 02's proof
transfers because the implementation has the same shape as the model, and `firestoreGateway.ts`
becomes the single file where a `setDoc` could physically be written, which is enforceable by lint
rather than by vigilance.

Two rules I want held even if someone thinks they're pedantic:
- **No `Date.now()` anywhere under `domain/`.** 02 dissolved the clock-skew debt *because*
  reconciliation reads no clock. A stray timestamp in there silently ends that property.
- **`decide` must be pure and re-runnable**, because Firestore re-executes transaction callbacks on
  contention. Anything minted inside it corrupts on retry — which is the same failure mode as 02's
  rejected counter, arriving through a different door. I asked the Mathematician to check whether
  that re-execution admits an interleaving its model ruled out.

Also recommended deploying an empty page to `pages.dev` at step 0, before any feature. The
destination is "running, not specified" and the pipeline is the highest-surprise, lowest-complexity
thing on the map. Flagged to the Builder as his call to overrule.

### 2026-08-25, later still — Mathematician's extended check, three defects

Builder pushed back on 02's verification (right call): the original model never included
`onSnapshot`, only `edit/delete/begin-push/commit-push`. Re-run to depth 9 across 5.4M states with
`onSnapshot` added and a sharper property (P1b, lineage-based) found three real defects, two of them
silent data loss. Full detail is the appendix on `02`; what I own out of it:

- **Ratified `lastServerState`** as an in-memory map owned by `sync/engine.ts`, not a stored field.
  It does not reopen 03 — 03's no-resume-token full re-read already means it self-heals from cold on
  every fresh tab, and the only place it matters is mid-session, which is exactly the gap the map
  exists to close. Written into `architecture.md` under its own heading rather than folded in
  quietly, since the Mathematician explicitly asked for it to be a visible ratification, not an
  assumption.
- Recorded in the module table: copy id/rev now derive from the flight token (defect 2 fix), and the
  Outbox slot may only migrate onto the copy the current push actually wrote (defect 3, which
  generalises the `delete-lost` trap from the first pass into a rule covering every branch).
- Flagged a real test obligation for whoever writes 09/engine tests: `delete-lost` must be asserted
  to *discard* unsynced pre-delete edits, not silently "fixed" later into a Conflict copy.

**Dead end worth recording**: 02's original deterministic-copy-id scheme leaned on "the same
device's own linear later state" to justify overwriting a pristine existing copy. That justification
is false the moment an outbox slot has migrated once already — the second conflict's content is not
descended from the first copy, it forked at the migration. I didn't catch this myself; it only fell
out once the model added snapshot events and a lineage-based property. Noting it because the same
shape of mistake — "this looks like it's obviously the same lineage" — is exactly the kind of thing
worth re-checking with the Mathematician rather than asserting from reasoning alone, which 02
originally did for the snapshot guard too.

### 2026-08-26 — Badrish's server-clock question, and the shape of my own mistake

He asked: why not a server clock as the base clock we compare against when notes arrive? Two
answers, and I want both on record because I got one of them half-wrong.

**Reconcile: no, and firmly.** A clock cannot detect concurrency — two writes at correctly-ordered
server times can still be mutually unobserved, and "later wins" is the data loss 02 exists to stop.
Sharper, and this is the bit worth keeping: **a server-assigned value can never be the identity
token**, because the push has to know the token it is writing *before* the round trip in order for a
retry after a lost response to recognise its own landed write. Server-assigned means known only
after. That is the counter's failure arriving through a third door — first the counter, then
"mint at send-press" in 02's manual-send amendment, now this. Three different proposals, one shared
defect: **the token must be minted locally, before the flight, or idempotency dies.** If a fourth
variant shows up, test it against that sentence first.

**The watermark: he's right and I was wrong to state the rejection unconditionally.** My dead-end
entry above justified killing `where('updatedAt','>',lastSeen)` entirely on client-clock skew. Under
a server-stamped field that path does not exist. I never considered the variant; I wrote a
conditional conclusion as an absolute one, which is precisely the "right answer, wrong reason" trap
I opened this notebook complaining about 02 doing. Recorded as an amendment on 03, not a rewrite.

It stays unadopted, on a *different* objection I found while checking his: **a filtered query never
delivers removals**, so a hard delete elsewhere leaves the Note in our mirror with nothing to correct
it. `persistentLocalCache`'s resume token solves the same read cost, delivers removals correctly,
needs no new field, no security-rule change and no proof. A watermark would be reimplementing it
worse. Order of preference: measure (Builder's step 7) → `persistentLocalCache` → `serverSeq`.

Two things I checked before answering, so nobody re-checks them: adding `serverSeq` later is cheap
(nulls on old docs, migration is one full re-read = today's behaviour), so deferring carries no
trap; and if it is ever adopted, the "max(serverSeq) over the delivered set is a safe watermark"
claim goes to the Mathematician first. It is the same *class* of claim as 02's snapshot rules —
plausible from reasoning, and those turned out to be wrong under model-checking.

### 2026-09-01 — the types, and the hole they exposed

Owed for five sessions, written today. `architecture.md` → "The types". The lesson I want to keep is
about the *delay*, not the content: I treated this as transcription — nine fields already settled by
01, two local fields already settled by 03 — which is exactly why it kept losing to more interesting
work. It was not transcription. Writing the actual TypeScript found a live hole in the mechanism
within twenty minutes. **When an artifact feels like it is only transcription, that is the argument
for writing it sooner, not for deferring it.**

**The hole: `conflictBase` is unobtainable at push time under the row shape as specified.** 02 wants
the copy to carry the *fork point*. The dirty row holds our tip (the edit is why it is dirty),
`lastServerState` holds their tip, and `baseRev` names the fork without storing its content. So the
one field 02 says cannot be retrofitted would have been written from whatever was to hand, and every
merge in ticket 11 is quietly two-way forever. Nobody would have noticed until a user merged.

Fix is a fourth local field, `baseContent: ForkPoint | null`, captured at **two** points. The first
(clean→dirty) is obvious. The second — commit of a clean push, where the base advances to the rev we
just landed while the row already holds text typed during the flight — is the one I nearly missed,
and it is precisely the "typed during the flight" case 02 split `begin-push`/`commit-push` to reach.
If someone later "simplifies" this to a single capture, that is the case that breaks.

Sent the sufficiency claim to the Mathematician rather than asserting it. Same class as 02's
original snapshot rules: reasoned, plausible, and wrong when checked. I am not going to relearn that.

**Decisions, with the ones I'd expect pushback on first:**
- Branded `NoteId`/`Rev`/`DeviceId`. Slight friction in fixtures; the alternative is a `noteId`
  passed where a `rev` belongs typechecking cleanly and failing as a wrong equality *inside the
  reconcile*. Reversal is three lines, so it is a cheap default, not a stake in the ground.
- `LocalNote extends NoteDoc` — I took ergonomics over structural safety here, knowingly. A
  `LocalNote` is assignable to `NoteDoc`, so nothing at the type level stops the whole row going to
  Firestore. The guard is a runtime key-set assertion on `toNoteDoc`, and I named it as the test the
  Builder writes *before* `toNoteDoc` exists. If that test is skipped, this decision is wrong.
- Two absence conventions in one document (`deletedAt: null` present, conflict fields absent). Looks
  like sloppiness, is forced: 01's rules type `deletedAt` as number-or-null and the conflict fields
  as string-or-**absent**, and the allowlist is closed, so `conflictOf: null` is a denied write.

**Dead end, ruled out:** nesting the wire doc inside the row (`{ id, doc, baseRev, ... }`) to make
serialisation leakage structurally impossible. It works, and it costs `row.doc.title` at every
access site across the entire app — a permanent ergonomic tax on every module to prevent one bug
that one test catches. Don't reopen it unless that test turns out not to be writable.

**Also noticed:** 01's rule "do not require `conflictOf` and `conflictBase` together" was written as
a general principle about rules not being schema validators. There is a *reachable* case that makes
it load-bearing — a dirty row with `baseRev === null` has no fork point, so its copy legitimately
has one field and not the other. Good rule, better reason.

### 2026-09-06 — my `baseContent` rule came back wrong, and the *shape* of why

The Mathematician model-checked the two capture points I wrote on 2026-09-01. Not sufficient: three
gaps, two of which write a wrong `conflictBase` — the field 02 says is unretrofittable. Corrected in
`architecture.md` in place, old rule marked superseded rather than deleted.

**The lesson is not "I missed three branches." It is that I keyed the rule to a branch at all.** I
wrote "on commit of a clean push" when the thing `baseContent` actually depends on is `baseRev`
moving. A rule keyed to a branch is wrong the moment a branch is added, and four branches move
`baseRev` here, plus a fifth transition (conflict-branch outbox-slot migration) that my rules never
mentioned — the one that writes a two-generations-stale `conflictBase` to a real document. State-
keyed rules do not have this failure mode, which is why `applySnapshot`'s 14-cell table over states
has survived every re-check and my prose rule did not. **Prefer the table.** I swept the rest of
architecture.md for the same shape and found no second offender; the sweep result and its reasoning
are recorded in the artifact so nobody re-runs it.

Second thing, and it is the more uncomfortable one: **`P-INV` was my proposed guard and it is a
shape check, not a correctness check.** It is exactly right as a biconditional — the model confirms
it is neither too strong nor too weak — and it survived ~900k states against the broken design
without firing once. So I proposed an invariant that is *true*, *cheap*, *enforceable*, and *blind
to the worst gap it was supposed to cover*. An invariant passing is not evidence the property holds
unless someone has shown the invariant implies the property. The lineage assertion is the real
check, it needs a per-rev content fixture, and it belongs at the reconcile, not in the store suite.

Related, same session: **`sameContent`'s doc comment claimed a `deletedAt`-as-boolean behaviour its
own signature makes impossible** — `ForkPoint` has no `deletedAt`. Builder caught it, kept the code
verbatim, and raised it instead of quietly patching, which is the right call. I agree with his
position and took it: the rule lives at the caller, against `ServerState`, and testable seam #4 has
moved to `domain/reconcile` (now seams 6 and 7 in the artifact). Worth noting *how* this got in: I
wrote the comment describing the concept and the body implementing the type, in one pass, and never
re-read one against the other. A doc comment that contradicts its signature is a cheap class of bug
to catch and I did not catch it.

### 2026-09-17 — architecture.md reconciled to step 3's `commitPush` move (record only, no decision changed)

Overseer caught the doc contradicting itself: table rows still put `PushOutcome` application in `engine.ts` after Builder moved it to pure `commitPush`. Fixed those plus four stale spots the grep turned up (port sketch, the `decide`-gets-`lastServerState` paragraph, `ServerState`'s `Pick` shape, the fallback sentence); kept Builder's three edits as written. Lesson: my port sketch named a `PushOutcome` type nobody ever defined — an undefined name in a design doc is a placeholder, and it drifted exactly as one would.

### 2026-09-17 (later) — architecture.md brought in line with step 4 (5343d58)

Builder asked; six settled decisions, none mine to reopen. Changed: the port sketch (now `SnapshotBatch`/`PushResult`, hedge dropped), a new listener-amendment paragraph under it, the module tree (`lastServerState.ts` gone — it's a `Map` in `engine.ts`; injected `Clock` + ESLint ban noted), the `lastServerState` section (adopt-view ruling added, my "rebuilds before any push can race it" line struck through, not deleted), the Read data-flow line, two table rows, the branch-vs-condition sweep sentence, and the Builder's gap-3 addendum with his leave (marked as amended by me).

**The mistake that was mine:** "rebuilds itself from the first batch of snapshots before any push can race it" was an ordering claim I asserted and nothing enforced — no push gate ever existed, and Firestore's empty from-cache first snapshot makes "first batch" meaningless anyway. Then the fallback rule keyed the adopt view on `initialSyncCompletedAt`, a *persisted* flag, guarding an *in-memory* map. Different lifetimes: flag survives the restart, map doesn't, so every Note read as gone at app open. **Check: any condition that guards a piece of state must have the same lifetime as that state.** Third reasoned-not-checked claim of mine the Mathematician has corrected; keep sending them.

Dead end, do not reinstate: gating pushes until the listener's first complete batch. Not needed — the adopt view falls back to the transaction read — and it would stall the Outbox for the entire offline case this app exists for.

### Testable seams I named for the Builder and for ticket 09

`NoteStore` port (contract suite run against a fake and against `idb` — this is how 09 gets a second
"device" without a second browser), `applySnapshot` (pure; 02's two model-checked traps live
entirely inside it), `reconcile` (pure, three equality tests, no clock), corpus projection (pure).
The emulator is then only for security rules and real transaction semantics. The `NoteStore`
interface is the one abstraction here I'd defend against a premature-abstraction charge: it exists
because the tests demand it, not because a second implementation is speculated.
