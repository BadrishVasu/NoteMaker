# Mathematician — notebook

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
