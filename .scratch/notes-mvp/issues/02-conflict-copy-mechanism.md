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
