# Builder's notebook — NoteMaker

## 2026-08-25 — read the whole decision record, responded to the architecture

First session. Read 01–12, CONTEXT.md, the map, designer's and ui-ux's notebooks, and the Designer's
`.scratch/notes-mvp/architecture.md` (which was written *while* I was reading — it landed mid-session).
My full assessment is in that file's `## Builder's response` section. Not restated here.

### The shape of this build, as I hold it

Three constraints do all the work and everything else is downstream of them:

1. Every Note write goes through `runTransaction`. One stray `setDoc`/`addDoc`/`writeBatch` anywhere
   silently reintroduces the whole data-loss class. The Designer's import boundary (only
   `sync/firestoreGateway.ts` may import `firebase/firestore`) is a **better guard than 02's name
   list**, because a name list can't anticipate `addDoc`. But it needs a second, intra-file
   assertion that inside that one file the only write path is `runTransaction` — the boundary stops
   the call being written elsewhere, not being written wrongly there.
2. Unpushed edits exist **only** in the local mirror. Anything that can clear that store is data
   loss, not a cache miss. `navigator.storage.persist()` is not a nicety.
3. `domain/` takes no clock. 02 dissolved 01's clock-skew debt precisely because reconciliation
   reads no time. A `Date.now()` under `domain/` silently un-proves the thing that was proved.

### Gaps I found that the tickets do not cover

Detail in architecture.md; the list, so I don't re-derive it:
`deviceId` is minted nowhere · 01's rules predate `rev`/`conflictOf`/`conflictBase` and will reject
every Conflict copy · nothing triggers a push (no online detection, so wake sources need deciding) ·
`conflictBase` halves the effective body cap so 05's 1 MiB threshold is wrong · push concurrency
across Notes undefined · the purge is a *write* and is unspecified · `applySnapshot` has no defined
behaviour for an absent `serverDoc`.

### The one I'd have missed if I hadn't counted it

03 prices the full re-read per app open against a 50k/day quota assuming desktop-shaped opens. The
design's own premise is that **Android reaps the app constantly**, so opens are 20–50/day, not one.
At 500 Notes that is already at 03's own tripwire. Not reversing it — `persistentLocalCache` is the
sanctioned one-line reversal and the `updatedAt` watermark stays dead — but the number must be
*measured* at step 7, not inherited.

### Sent to the Mathematician

02's model interleaved `edit`/`delete`/`begin-push`/`commit-push` — **`snapshot-delivered` is not in
that list**, yet 02's second trap is entirely about snapshots. So that trap was likely reached by
reasoning, not by the check, and `applySnapshot` is the one part of the mechanism carrying an
unverified invariant. Asked for a re-run with snapshots as an event, plus a complete
`applySnapshot(localRow, serverDoc)` decision table I can turn straight into unit tests, plus whether
concurrent per-Note pushes break any cross-Note invariant. The Designer independently asked it a
different question (does Firestore's transaction-retry re-execution admit an interleaving the model
ruled out) — both are with it, neither needs sending twice.

### Dead ends and things not to re-open

- **`navigator.onLine` / any offline badge.** Dead by 02, and ui-ux's notebook already burned a
  draft on it. The connectivity oracle that *is* honest is snapshot delivery: a delivered snapshot
  proves the transport is up and costs nothing. Use that to wake the push loop.
- **Manual save as a mode.** If built as a mode it widens 02's dirty predicate beyond
  `pendingRev !== null`, which needs a second stored field — exactly what 03 killed the `synced`
  boolean for. Put a `Push now` button to Badrish instead; same control, invariants don't move.
- **A store library for the corpus.** One array, one subscribe. But `useSyncExternalStore` over a
  single whole-corpus snapshot re-renders every row on any change; the fix is immutable rows in a
  `Map` with stable identity, not a library.

### Positions I've taken so nobody waits on me

- List ordering `updatedAt desc`, no pinning. One comparator, trivially reversible.
- Serialise the Outbox drain until the Mathematician says per-Note pushes are independent.
- No build team before step 6. Steps 0–4 are pipeline plus pure logic; specialists there cost
  coordination and buy nothing.
