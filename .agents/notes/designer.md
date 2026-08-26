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

### Testable seams I named for the Builder and for ticket 09

`NoteStore` port (contract suite run against a fake and against `idb` — this is how 09 gets a second
"device" without a second browser), `applySnapshot` (pure; 02's two model-checked traps live
entirely inside it), `reconcile` (pure, three equality tests, no clock), corpus projection (pure).
The emulator is then only for security rules and real transaction semantics. The `NoteStore`
interface is the one abstraction here I'd defend against a premature-abstraction charge: it exists
because the tests demand it, not because a second implementation is speculated.
