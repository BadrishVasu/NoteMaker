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

### Testable seams I named for the Builder and for ticket 09

`NoteStore` port (contract suite run against a fake and against `idb` — this is how 09 gets a second
"device" without a second browser), `applySnapshot` (pure; 02's two model-checked traps live
entirely inside it), `reconcile` (pure, three equality tests, no clock), corpus projection (pure).
The emulator is then only for security rules and real transaction semantics. The `NoteStore`
interface is the one abstraction here I'd defend against a premature-abstraction charge: it exists
because the tests demand it, not because a second implementation is speculated.
