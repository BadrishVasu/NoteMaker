# Conflict-copy mechanism under Firestore's offline queue

Type: grilling
Status: resolved
Blocked by: 01

## Question

Given that Firestore's offline queue replays queued writes unconditionally on reconnect, how do we
detect that two devices edited the same Note while apart, and preserve the losing edit as a
Conflict copy instead of discarding it?

The default SDK behaviour is exactly what the locked decision rules out: the later-arriving write
wins and the other edit vanishes with no trace. Options to weigh include a monotonic version or
`baseUpdatedAt` field checked inside a Firestore transaction, bypassing the offline queue for Note
bodies and running our own outbox, or reconciling after the fact by comparing what we last pushed
against what came back.

Settle: the detection mechanism, where the Conflict copy is written and how it is linked to its
sibling, whether a conflict can be detected at all once the SDK has already overwritten the
document, and what happens in the three-way case where a device has been offline across several
remote edits.

This is the hardest decision on the map and the one most expensive to get wrong — consult the
`mathematician` agent rather than deciding it alone.

## Handed down from ticket 01

- `updatedAt` is a **client-clock epoch millis** value, not a server timestamp. Clock skew between
  devices is therefore real and this ticket owns bounding it — 01 accepted the skew deliberately
  because a server timestamp reads back null offline.
- A `<version>` field is **reserved but unnamed** in the Note document. This ticket names it and
  defines its semantics.
- From ticket 07's research: **Firestore persistence cannot run inside a service-worker or
  web-worker scope at all**, so there is no background sync. Reconciliation can only happen while
  the app is open, which constrains any design that assumed a background reconciler.

## Answer

Settled with Badrish; the mechanism was derived and model-checked by the `mathematician` agent.

### Verdict: our own outbox, not the SDK's offline queue

Two facts decide this ticket, both verified against Firebase documentation:

1. `runTransaction` requires a live round trip and **rejects when offline**. It never enters the
   offline mutation queue.
2. A pending local write **hides the server's version**: the SDK overlays local mutations on the
   last-synced remote document, and no API exposes the remote base underneath.

Chained, they mean a conflict **cannot be detected after the fact**. If device A edits offline while
B edits online, A's queued mutation lands on reconnect, B's edit is gone from the server, and A
never observed it. There is no reconcile-after-the-fact design, which rules out the "compare what we
last pushed against what came back" option this ticket floated. The mechanism must prevent the
replay, not react to it.

The alternative considered and rejected was **per-device documents plus a version vector**
(`notes/{noteId}/devices/{deviceId}`), which makes the SDK's offline queue safe by construction. It
was rejected because its only structural advantage is illusory: per ticket 07 the SDK's queue also
only drains while the app is open, so it buys durability our own outbox already has. It pays for
that in a broken document shape (one Note becomes one document per device, forcing ticket 06's
search to materialise before it can scan), per-device documents that are never garbage collected,
and security rules that can only cosmetically check a client-chosen device id against a path
segment. It also does not remove the problem: a version vector detects concurrency but does not
resolve it, so a Conflict copy is still owed, plus new coordination so that two devices reaching the
same verdict independently do not each write one.

The constraint that looked fatal to the outbox is not one: **its transactions only ever run at
reconnect, which is precisely when transactions work.**

### The enforcement policy

**Every Note write goes through `runTransaction`. `setDoc` and `updateDoc` are never called on a
Note.** Offline writes then reject naturally and never enter the SDK queue. All writes route through
a single push module, because one stray `setDoc` anywhere reintroduces the entire bug class. Ticket
09 owes a test that enforces this.

Side effect: **no online-detection code at all.** `navigator.onLine` is never consulted; the
transaction is attempted and backed off on failure.

### `rev`: ticket 01's reserved field

`rev: string`. An **opaque identity token**, not a version number and not a timestamp: a fresh
random auto-id-shaped token minted at edit time. The outbox stores it as `pendingRev` alongside
`baseRev`, the rev the edit forked from (null for a create).

A counter was rejected because it breaks idempotency: on a retried push the server reads N+1, which
differs from base N, and the device fabricates a Conflict copy of its own text. A token compared by
equality is idempotent under lost responses and multiple tabs.

### The reconcile

Three equality tests inside the transaction. No clock, no ordering, no diff:

- `srv.rev === pendingRev` — our write already landed (retry or second tab). Clear dirty.
- `srv.rev === baseRev` — clean push. Write content with `rev = pendingRev`.
- otherwise — conflict.

The conflict branch, in order:

1. **Fast-forward** if `title`, `titleIsCustom` and `body` match and the null-ness of `deletedAt`
   matches. Adopt the server, write nothing. `deletedAt` is compared as a boolean, because two
   deletes carry different millis and would otherwise conflict pointlessly.
2. **Our delete lost to their edit** — drop the delete and adopt the server version. The Note comes
   back to life. This is the one place the mechanism discards a user action, justified because a
   delete is trivially repeatable and destructive by intent, so auto-replaying it is the dangerous
   choice.
3. **Otherwise our edit lost** — the server survives at `noteId` **untouched**, and our content is
   written as a **live** Conflict copy (`deletedAt: null`), even when the winner is a Tombstone.

The conflict branch writes **only** the new copy. `noteId` is read, which puts it in the
transaction's read set so a concurrent change aborts and retries, but it is never written.

**The three-way case is not a special case.** A device offline across several remote edits sees a
`srv.rev` matching neither token and takes the same branch. Only the common ancestor and the two
tips matter; the intermediates are irrelevant.

### The Conflict copy

- **Deterministic id**, `noteId` joined to the device id. This is what makes the conflict branch
  idempotent: a retry or a second tab overwrites the same document instead of piling up copies, and
  repeated conflicts from the same device coalesce. That overwrite is safe because the newer content
  is that same device's own linear later state. Guard: if the copy already exists and `updatedAt`
  differs from `createdAt`, the user has edited it, so fall back to an id that also carries
  `pendingRev`. The pristine test fails safe, since a spurious bump only yields one extra copy. This
  does not violate ticket 01, whose reason for auto-ids was client-side generation with no round
  trip, which is preserved.
- **Title and `titleIsCustom` are inherited unchanged.** The copy is **not** latched to Custom and
  carries **no marker in the title string**. Programmatically latching a Note to Custom is drift from
  `CONTEXT.md`, which defines Custom titled as the state a Note enters the moment the *user* types in
  the title field; the latch is permanent and invisible. A title marker would also survive the merge
  and pollute ticket 06's search. The copy is marked **structurally** and the UI renders a badge from
  that. Duplicate titles in the list are already legal.
- **`conflictOf`** — the id of the surviving sibling.
- **`conflictBase`** — the fork-point `title`, `titleIsCustom` and `body`, on Conflict copies only.
  This is the one provision that genuinely cannot be retrofitted: it costs one body-sized string now
  and is unrecoverable later, and without it the merge is two-way and cannot distinguish "I added
  this line" from "they deleted this line".

### Interactive merge is a layer on top, never in the sync path

Badrish proposed holding the push at reconnect and choosing which differences land. Reshaped: an
interactive step in the sync path can block sync, queues dialogs when several Notes conflict at
once, and strands the write on dismiss or a dropped connection. So the Conflict copy is written
**automatically and immediately**, and the merge is offered afterwards from the Note itself via the
`conflictOf` pointer. The automatic path is the floor and can never lose data; the merge becomes an
ordinary edit over two Notes that are both already durable. See ticket 11.

**No automatic three-way merge, ever.** A silent text interleave has no test oracle.

### Two traps for the implementation

Both were found by model-checking, not by reasoning. The first is a live data-loss bug.

- **`baseRev` may only advance to a rev whose content this device actually pushed.** Legal in the
  already-landed, clean-push and fast-forward branches. **Illegal in the delete-lost branch**: if the
  user typed on top of an in-flight delete, that text is not descended from the server's content, so
  advancing `baseRev` makes the next push look clean and silently clobbers the other device. Correct
  handling is to stay dirty at the old base and re-evaluate, which lands in the conflict branch next
  round.
- **An incoming `onSnapshot` must never advance `baseRev`, and must never overwrite a dirty Note's
  local body.** Snapshots update clean Notes and record observed server state, nothing more. A
  snapshot that advanced the base would adopt the other device's edit as our fork point and destroy
  it on the next push, reintroducing the original bug.

On push completion, `baseRev` becomes `pendingRev`; if the user typed during the flight, mint a
fresh `pendingRev` from the new base rather than re-pushing the stale one.

**The editor follows the content, not the id.** Under the server-survives rule the reconciling
device's text moves to the copy, so its outbox slot migrates with it and an open editor redirects to
the copy. Otherwise the cursor lands mid-sentence in the other device's text. This is a requirement
02 imposes on ticket 11.

### Which side keeps the Note id, and why

The server's version survives; the **reconciling device's** edit becomes the Conflict copy. Both
rules are deterministic, but only this one is atomic: the displaced text always belongs to the device
currently running the code, so it can redirect its own editor synchronously. Reversed, the displaced
text sits on a remote device that must discover the move via snapshot and re-point its editor after
the fact, a race that cannot be closed.

Felt consequence, accepted by Badrish: **the Note being written offline is the one that becomes the
copy.** It is never seen mid-typing, because the editor follows the text; it is seen in the list.

### Verification

Model-checked rather than asserted, as a throwaway spike: two devices exhaustively interleaved over
edit, delete, begin-push and commit-push, with the push split so that "user types while a push is in
flight" is exercised. Asserted that no write destroys content the writing device never observed,
that both devices and the server converge to an identical corpus, and that unsynced content always
survives reconnect. **2,396,744 interleavings to depth 7, all three properties hold.** The run found
the `baseRev` trap above as a genuine failure.

Limits, stated honestly: two devices only, no user editing of a Conflict copy mid-run (so the
pristine-guard fallback rests on reasoning rather than the model), and no purge.

### Consequences beyond this ticket

- **Clock skew no longer needs bounding.** Nothing in the mechanism reads a timestamp. `updatedAt`
  survives only as a list sort key, where skew is cosmetic and self-heals on the next edit. Keep
  ticket 01's "not absurdly future-dated" rules guard, which is already written and caps the blast
  radius, but build no skew machinery. **Ticket 01's deferred debt is dissolved, not paid.**
- **Ticket 03 is largely forced.** Offline edits never enter the SDK cache, so they exist only in our
  store; keeping clean Notes in the SDK cache and dirty Notes in ours is exactly the
  two-stores-disagreeing failure 03 warns about. One own mirror, with Firestore configured for
  memory-only local cache so the SDK becomes pure network transport. 03 ratifies this rather than
  reopening it.
- **Simultaneous online editing of one Note still produces Conflict copies.** Inherent to
  last-write-wins without a CRDT, and the accepted cost of the locked decision. The deterministic
  copy id bounds it to one copy per Note per device rather than a pile.
- **Web Locks leader election is optional**, not a correctness requirement, because the token design
  already makes multi-tab safe. Cross-tab local-store coherence belongs to ticket 03.
- **`Sync watermark` names nothing in this design** and is cut from `CONTEXT.md`. `onSnapshot` owns
  the pull and the SDK keeps its own resume token, while the push side compares `rev` equality, not a
  point in time. **Outbox** and **Fork point** replace it.
- **A device offline past the 30-day purge**, holding an edit to a Note that has since been purged,
  recreates its text as a live Conflict copy. Consistent with the rules, never loses writing,
  accepted. Suppressing it is machinery for a case that will not occur.

### Amendment, 2026-08-25 — manual-send setting

Badrish added a settings toggle: when on, an edit writes to the mirror immediately but is not
pushed until the user presses a send affordance. UI/UX flagged a possible break in the snapshot
guard (`onSnapshot` must never overwrite a dirty Note's body) and asked the mathematician to
re-check before anyone built on it.

**The failure UI/UX suspected is real, but only under the implementation they had in mind — not
under this mechanism as specified.**

UI/UX's candidate implementation deferred *minting `pendingRev`* to the send press ("mint
`pendingRev` at button-press instead of edit-time"). Concretely: Note N is synced on both devices
at `rev = R0`. On device A (manual send on) the user types, so the mirror body changes but
`pendingRev` stays `null` — under that plan the Note is not yet "in the Outbox." Device B edits
and pushes, landing `rev = R1` on the server. A's `onSnapshot` fires; the guard checks dirtiness
via `pendingRev !== null`, finds `null`, concludes the row is clean, and overwrites A's local body
with B's server content and advances `baseRev` to `R1` — destroying text the user is actively
looking at. This is exactly the class of bug the guard exists to prevent, reintroduced by
conflating "queued to send" with "has unconfirmed local content."

**Fix: don't defer minting `pendingRev`.** Entering the Outbox stays exactly as this ticket
already specifies — unconditional, at edit time, on every keystroke, regardless of the manual-send
setting. `pendingRev` is minted and the row becomes dirty the instant the user types, in both
modes. The setting only gates one thing: **whether the debounced flush is allowed to call
`runTransaction` for a dirty row.** In auto mode the flush attempts the push as soon as debounce
allows (as already specified). In manual mode the flush is additionally gated on the user having
pressed the Note's send affordance since its last push attempt; `blur`, `visibilitychange` and
`pagehide` do not force a push in manual mode (they force nothing extra, since the mirror write is
already synchronous per keystroke and durability was never gated by the flush).

This is a one-line change to the trigger condition of `begin-push`, a client-side gate that sits
outside the transaction entirely. It touches nothing this ticket specified: `pendingRev`/`baseRev`
semantics, the reconcile transaction's three equality tests, the conflict branches, and the
snapshot guard (`pendingRev !== null` stays correct and untouched, because a Note the user is
mid-typing on *is* dirty from the first keystroke in both modes). No new document field, no new
mirror field beyond a client-only "send requested since last dirty" bit that never enters the
transaction's read or write set.

**"Dirty" is not the wrong signal.** `pendingRev !== null` already means "has local content not
yet confirmed by the server," which is the correct predicate. What was wrong was treating "in the
Outbox" as synonymous with "about to be pushed" — this ticket never made that equation; the two
were already separate concepts (recording an edit vs. attempting a push, itself already
asynchronous and debounced) and manual send is just a second, user-controlled gate on the
already-asynchronous push attempt.

**Re-verification is a corollary, not a re-run.** The model check exhaustively explored
interleavings of `{edit, delete, begin-push, commit-push}` to depth 7, where `begin-push` already
fires nondeterministically — including traces where it is deferred arbitrarily long relative to
`edit`. Manual send does not add a new action or a new state; it only further restricts *when* the
scheduler may choose `begin-push`, which is a subset of schedules already inside the checked
transition system. A safety property that holds for every schedule in a set holds for every
schedule in any subset of it. So the three invariants (no write destroys unobserved content,
devices and server converge, unsynced content survives reconnect) carry over to manual send without
re-running the model, at the same depth-7 confidence as before — neither better nor worse than the
existing limit.

**Verdict: no change to the reconcile mechanism, the guard predicate, or the document schema.**
Manual send is implemented one layer up, in the flush trigger, not in 02's transaction or guard.

## Appendix — re-verification with `snapshot-delivered` (mathematician, 2026-08-25)

Builder challenged the Verification section above: it lists four event kinds — `edit`, `delete`,
`begin-push`, `commit-push` — and no snapshot, yet the second trap is about snapshots. The
challenge is correct. **`snapshot-delivered` was not in the original model; the two snapshot rules
above were reasoned, not checked.** The model has been extended and re-run. It found **three
defects**, one a permanent divergence and two silent data loss. All three are corrections to this
ticket, not to ticket 03.

### What the extended model covers

Two devices, one server, one primary Note plus its Conflict copies. Events: `edit`, `delete`,
`begin-push`, `commit-push`, `lose-response`, `snapshot-delivered`, `purge`. The push is split so
the server-side transaction executes atomically at `begin-push` while local bookkeeping happens at
`commit-push` — that is what makes "typed during the flight" and "response lost" reachable.
Snapshot delivery is a per-device FIFO queue that coalesces beyond depth *k*; both *k*=1
(coalescing only) and *k*=2 (in-order **stale** delivery) were run, because a transaction read is
fresher than the listener stream and that gap turns out to matter.

Properties, sharpened from this ticket's three:

- **P1** — no content token vanishes unless its own author superseded it (a later edit, or a delete,
  on the same row), or it was legitimately overwritten, or the user purged it.
- **P1b** — *a server write may only destroy content it is descended from.* This is the sharp form
  of "no write destroys content the writing device never observed", and it is what catches the
  `baseRev` class of bug. The weaker "the writer had observed that rev" does **not** catch it.
- **P2** — from every reachable state, driving to quiescence converges both devices and the server
  to an identical corpus with no row left dirty.
- **P4** — a Conflict copy is never born pointing at a document that does not exist.

Exhaustive to **depth 8 across four configurations (713,911 / 722,771 / 723,579 / 732,375 states)
and to depth 9 on the recommended configuration (5,466,627 states). All properties hold.** Every visited state is additionally driven to quiescence and re-checked, with an
app reopen appended — 03 has no resume token, so every open re-reads the whole subcollection, and
that re-read is load-bearing for convergence in one corner (below). The rejected alternatives below
each fail the model under the corrected design, so these are discriminated decisions, not taste.

### Defect 1 — `commit` must never populate the local row from the transaction's read

**Permanent divergence, found as P2.** The `fast-forward`, `delete-lost` and `conflict` branches
adopt "the server version". If they adopt the value read inside the transaction, they can move a
clean row *behind* the listener — and no correction follows, because in the conflict branch the
surviving Note is deliberately **not** written and so generates no snapshot. The device displays
stale text indefinitely.

**Fix.** Keep an in-memory `lastServerState: Map<noteId, {rev, title, titleIsCustom, body,
deletedAt}>`, updated by **every** snapshot in **every** cell — including for dirty rows, where
nothing else about the row changes. This is exactly what this ticket already asked for with
"snapshots … record observed server state"; ticket 03's row shape (`baseRev`, `pendingRev`,
"nothing else") quietly dropped it. It does **not** need an IndexedDB column: 03 re-reads the whole
subcollection on every app open, so the map rebuilds from the first snapshot before any push can
matter.

Those three branches then adopt from `lastServerState`, falling back to the transaction read only
while 03's `initialSyncCompletedAt` is unset. After the first snapshot the map is a complete picture
of the server, so **an absent entry means the document is gone** and the local row is deleted rather
than re-materialised from a stale transaction read.

Safe in both directions: if the map is current we adopt the truth; if the map is behind, the
document changed after we last heard about it, so a delivery is already guaranteed to follow and
will correct us.

### Defect 2 — the deterministic copy id plus the pristine guard loses data

**Silent data loss, found as P1b.** Trace: a device conflicts on `N`, its text moves to
`N#c<device>`, and its outbox slot migrates with it. It then edits `N` again — from the *adopted
server* content — and conflicts a second time. The copy on the server is still pristine, because the
user never edited it, so `updatedAt === createdAt` and the guard permits the coalescing overwrite.
But the second conflict's text is **not** descended from the first's: the lineage forked the moment
the outbox slot migrated. The first copy's content is destroyed. This ticket's justification — "that
same device's own linear later state" — is false on that path.

**Fix, which also retires the pristine guard.** Derive **both** the copy id and the copy's `rev`
from the flight token:

- `copyId = <noteId>__c<deviceId>__<flightRev>`
- `copy.rev = flightRev`
- the transaction writes the copy **only** if that document is absent, or is already at
  `rev === flightRev`. Any other rev means somebody has edited it since — write nothing, because our
  content is that content's ancestor and is therefore legitimately superseded.

Idempotent under a retry and under a second tab (same row, same `pendingRev`, same id and rev),
distinct across two independent conflicts, and the `updatedAt !== createdAt` guard disappears
entirely. Cost: repeated conflicts from one device no longer coalesce into one copy. That coalescing
*was* the bug — each copy holds genuinely unmerged content and each is owed.

### Defect 3 — the outbox slot may only migrate onto the copy we just wrote

**Silent data loss, found as P1b.** The migration target can be occupied: the copy row may already
have arrived by snapshot and been edited by the user, or gone clean at a *newer* rev after that edit
was pushed. Testing only "is the copy row dirty" is not enough — a copy row that is clean at some
other `baseRev` still holds content that is not ours.

**Fix, and it generalises this ticket's `delete-lost` trap into a rule.** The slot migrates only if
the copy row is absent, or (`pendingRev === null` **and** `baseRev === copyRev` — i.e. it is exactly
the pristine copy this transaction just wrote). Otherwise, and in every case where the user typed
during the flight and the target is not free, **the local row does not adopt the server at all**: it
stays dirty at its old `baseRev` and re-evaluates on the next push, which produces a second copy
keyed by the new flight token. Lossless; the cost is one extra copy in a corner.

The rule, stated once: *a branch that did not write our content never advances the row's `baseRev`
and never adopts the server, unless the row is still exactly what we pushed.* This ticket stated it
for `delete-lost` only. It holds for `fast-forward` and `conflict` too.

### `applySnapshot(localRow, serverDoc) -> localRow` — the complete table

Pure. **It does not need to know whether a push is in flight** — every in-flight cell is identical to
its not-in-flight twin, which preserves ticket 03's pure seam. Every cell, in every row state, also
updates the in-memory `lastServerState` (present ⇒ record; absent ⇒ delete the entry). That side
effect is Defect 1's fix, and it is the only thing a snapshot does to a dirty row.

| # | local row | serverDoc | action | reachable? |
|---|---|---|---|---|
| 1 | absent | absent | no-op | yes — removed event for a Note never mirrored |
| 2 | absent | present | insert clean row from `serverDoc`; `baseRev := rev` | yes — new Note from the other device; first sync |
| 3 | clean | absent | **delete the local row** | yes — purge or Delete forever elsewhere |
| 4 | clean | `rev === baseRev` | no-op; assert content already identical | yes — re-delivery |
| 5 | clean | `rev === pendingRev` | — | **unreachable**: clean *is* `pendingRev === null`. Assert. |
| 6 | clean | neither | adopt content; `baseRev := rev` | yes — the other device edited |
| 7 | dirty | absent | **no-op** — keep the row and its dirt | yes — purge/Delete forever while we hold an edit |
| 8 | dirty | `rev === baseRev` | no-op | yes — server still at our fork point |
| 9 | dirty | `rev === pendingRev` | **clear dirty**: `baseRev := rev`, `pendingRev := null`, content untouched (assert equal) | yes — our own write returning; lost response; second tab |
| 10 | dirty | neither | **no-op.** Do not touch content. Do not advance `baseRev`. | yes — this ticket's trap |
| 11–14 | dirty, push in flight | (all four) | **identical to 7–10** | yes |

`serverDoc` absent factors out the rev comparison entirely, so "absent row × rev" is not a cell.

**This ticket's wording needs one correction.** "An incoming `onSnapshot` must never advance
`baseRev`" is true only for *dirty* rows. For a clean row, advancing `baseRev` is the entire
mechanism (cells 2, 4, 6); implementing that sentence literally breaks sync. The precise invariant:

> `baseRev` may only ever be set to a rev the listener delivered for a clean row, or to a rev this
> device itself wrote.

That invariant is also what makes cell 6 always a *forward* adopt, since listener deliveries are
monotone per document.

### Snapshot delivering our own write (cell 9): clear dirty

Both policies pass every property at depth 8 under both queue depths, so this is decided on quality,
not safety. The answer is **clear dirty**.

- Provably content-safe. Rev tokens are unique and locally minted, and a local edit always mints a
  fresh one, so `pendingRev` always names the row's *current* content. The server can hold
  `rev === pendingRev` only because our push wrote exactly that content. Advancing `baseRev` there is
  advancing to a rev this device wrote — precisely what the trap permits.
- With "ignore", a **lost transaction response** leaves the row dirty; if the other device edits on
  top of our landed write before our retry, the retry sees a rev matching neither token and writes a
  **spurious Conflict copy of content that already landed and was already superseded**. "Clear"
  removes that path.
- The push path is not robbed of ownership, because the two paths cannot disagree. Only the
  *already-landed* and *clean-push* branches can produce `srv.rev === pendingRev`, and both apply
  exactly the transition the snapshot just applied. `commit` must therefore treat
  `pendingRev === null` as a no-op. Two tests: commit-after-snapshot-cleared is a no-op;
  snapshot-after-commit is a no-op.

### `serverDoc` absent with a dirty row: recreate, do not write a Conflict copy

This ticket's stated consequence — "a device offline past the 30-day purge recreates its text as a
live Conflict copy" — is right in intent and **wrong in mechanism**. Running the model with that
rule fails P4 in eight steps: the copy is born pointing at a document that does not exist.

`applySnapshot` does nothing (cell 7). The **push** resolves it, and it is not a conflict:

- `baseRev === null` → ordinary create.
- the flight is a delete → the outcomes agree; write nothing, delete the local row.
- otherwise → **recreate at `noteId`**, `rev := pendingRev`. There is no surviving sibling, so
  nothing is displaced and nothing is owed a pointer. Idempotent: a retry sees
  `srv.rev === pendingRev` and takes the already-landed branch.

Separately, and independent of this decision: **`conflictOf` can dangle anyway.** A copy created
legitimately against a live sibling dangles the moment that sibling is purged or deleted forever;
the model reaches this in six steps. **`conflictOf` is a soft pointer and ticket 11's UI must
tolerate a missing target.** Do not add referential machinery.

Accepted limit: a purge that lands *after* our recreate wins, and the recreated text is gone. The
user pressed Delete forever; that is not silent loss.

### Concurrent pushes across Notes: per-Note independence is total

The read set and the write set of a push for Note `X` are both contained in
`{X, copyId(X, thisDevice, flightRev)}`, and both members are functions of `X` and this device. For
`X ≠ Y` the sets are disjoint, so **no cross-Note invariant exists and pushes parallelise freely.**
The only serialisation requirement is per-Note: **at most one in-flight push per Note**, or two
flights race the same row's bookkeeping. Bound total concurrency for quota and backoff reasons if
you like, but not for correctness.

Two things that look like cross-Note coupling and are not: ticket 01's `Untitled Note N` scan can
pick the same number on two devices at once (duplicate titles are already legal per this ticket),
and the mirror's IndexedDB writes are per-row.

### Behaviour accepted rather than fixed

- **A one-delivery regression window.** A snapshot already in flight when we commit our own write can
  deliver the pre-write state to a now-clean row, so it briefly shows older content. Our write
  guarantees a following delivery, so it heals within one snapshot. All properties hold with stale
  delivery enabled; the cost is a flicker, never loss.
- **A purge racing a push** can strand one device on a stale clean row until the app is reopened.
  03's no-resume-token full re-read on every open is what heals it — the model's convergence check
  includes that reopen for this reason. This is a real dependency of 02 on 03's accepted price.
- **`delete-lost` discards unsynced edits made *before* the delete in the same dirty episode.** If
  the user types offline, then deletes offline, and the delete loses, that text is gone. Deliberate:
  the user's last expressed intent for it was to delete it, and preserving it would mean a Conflict
  copy of text they threw away. Ticket 09 should assert the discard, so nobody "fixes" it later.

### Limits of this run

Two devices; one primary Note plus its copies; no interactive merge; title and `titleIsCustom` ride
with content rather than being modelled separately; fast-forward on independently-identical text is
not exercised, since tokens are unique by construction (it is a no-op branch either way); no third
device. Depth 9. The spike is throwaway and deliberately not committed.
