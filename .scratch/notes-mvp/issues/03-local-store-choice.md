# Local store: Firestore's built-in persistence alone, or a Dexie mirror

Type: grilling
Status: resolved
Blocked by: 02

## Question

Is Firestore's own IndexedDB persistence the local store, or do we keep a separate Dexie/IndexedDB
mirror alongside it?

Firestore's persistence is free and already there, but it is opaque: we cannot query it the way we
would our own table, and whatever ticket 02 decides about an outbox may require state the SDK does
not expose. A separate mirror gives full control and makes client-side search trivial, at the cost
of two stores that must agree.

Settle: which store is the source of truth the UI reads from, whether search (ticket 06) reads the
SDK cache or our mirror, how the app behaves on first load on a new device with an empty cache, and
what the eviction or size story is as the corpus grows.

## Handed down from ticket 02

02 largely forces this ticket's core answer, and it should be **ratified rather than reopened**.
Because every Note write goes through `runTransaction`, offline edits never enter the SDK cache at
all — they exist only in our own store. Keeping clean Notes in the SDK cache and dirty Notes in ours
is precisely the two-stores-disagreeing failure this ticket warns about. So: **one own mirror as the
source of truth, with Firestore configured for memory-only local cache**, reducing the SDK to pure
network transport. Search (ticket 06) therefore reads our mirror.

What remains genuinely open here: the store technology itself, first load on a new device with an
empty mirror, cross-tab coherence between two tabs sharing one Outbox (02 established that Web Locks
leader election is **optional** for correctness, since the `rev` token design already makes the push
path multi-tab safe — but local-store coherence is still this ticket's problem), and the size and
eviction story as the corpus grows.

## Answer

Decided by the `designer` agent.

### Ratified, with the reasoning corrected

One own mirror is the source of truth; the UI, the list, and ticket 06's search read only it.
Firestore runs on **memory-only local cache** and is pure network transport: `onSnapshot` in,
`runTransaction` out.

The conclusion stands, but 02's stated reason for it does not, and shipping on a wrong reason means
the next person reverses it for the wrong reason too. **The two stores would not actually disagree
in any way a user could see** — if nothing ever reads the SDK cache, its holding clean server state
while our mirror holds server-plus-dirty state is not a disagreement, it is a private detail. The
three reasons that do hold:

1. **A second full copy of the corpus on disk buys nothing.** The persistent SDK cache exists to
   serve reads and to survive a restart with a resume token. We serve every read from our own mirror,
   so its entire remaining value is the resume token — paid for by storing every Note twice.
2. **It bounds the blast radius of the one mistake that breaks 02.** Memory cache does *not* stop a
   stray `setDoc` from entering the offline mutation queue — only routing every write through
   `runTransaction` does that, which is why ticket 09's "no `setDoc` on a Note" test is still the
   real guard. But with memory cache a queued write dies with the tab instead of replaying days
   later on a machine nobody is watching. Defence in depth, not the defence.
3. **Multi-tab persistence coordination disappears** — no `persistentMultipleTabManager`, no leader
   election, no shared-cache failure modes we would have to reason about on top of 02's.

Configure it **explicitly**, `initializeFirestore(app, { localCache: memoryLocalCache() })`, even
though memory is already the modular SDK's default (ticket 08). The default is what a future
contributor flips without noticing; an explicit line is a thing to read and a thing to assert on.

**The price, stated plainly: with no persisted resume token, every app open re-reads the entire
subcollection.** At a few hundred Notes against a 50k/day free read quota this is comfortable; it is
the first thing to feel a growing corpus. The obvious mitigation — subscribing with
`where('updatedAt', '>', lastSeen)` — is **rejected**: that is the Sync watermark 02 cut from
`CONTEXT.md`, and under client clocks a device whose clock lags writes an `updatedAt` beneath our
watermark and its Note is never seen again. Silent, permanent data loss to save a read quota we are
not near. **Tripwire instead**: if reads per day approach half the free quota, turn
`persistentLocalCache` back on. Reversing costs one line plus re-verifying 02's two snapshot rules,
so this is a cheap default rather than a load-bearing commitment.

### Store technology: `idb`, not Dexie

**A single IndexedDB object store `notes`, keyed by `noteId`, accessed through `idb` (~1.2 kB).**

Dexie is the reflexive answer and it is the wrong one *here*, because its value is queries and
compound indexes and we will not issue a query. The corpus is one person's Notes: a few thousand at
the outside, a few megabytes. **The entire corpus is loaded into memory at boot and stays there.**
Every read the app performs — list, Trash, search, the `Untitled Note N` scan ticket 01 needs, the
Outbox walk — is a pass over an in-memory array. The store is therefore a key-value box that needs
exactly `getAll`, `put`, `delete`, and a transaction; that is raw IndexedDB with the event-callback
boilerplate removed, which is precisely what `idb` is and all it is. 25 kB of query engine for a
`getAll` is the premature abstraction the standing preferences rule out.

This also lands ticket 01's deferred question: **no composite indexes are required**, because the
whole subcollection is subscribed and every filter and sort happens in memory. Close that deferral.

**One database per user, named `notemaker-<uid>`.** Isolation becomes a property of the database
name, matching how 01 made it a property of the Firestore path — there is no query that can forget a
`where uid ==` clause because there is no such clause. Retained across sign-out; a second account
cannot see the first's Notes, and an explicit "clear local data" action is out of scope here.

### The Outbox is a column, not a table

The mirror row is the server document shape from ticket 01 plus 02's local fields — `baseRev`,
`pendingRev` — and nothing else. **`pendingRev !== null` *is* dirty; the Outbox is the subset of
rows where it is set, not a second store.** Two reasons: it matches `CONTEXT.md`, which defines the
Outbox as *a set of Notes*, not a queue of operations; and it makes "record the edit and enter the
Outbox" one atomic `put` of one row rather than two writes in two stores that must agree — the exact
class of failure this ticket was opened to avoid, reintroduced one level down.

No `synced` boolean, no separate dirty index. `pendingRev` already carries the state and 02 already
gave it meaning; a second flag can only drift out of step with it.

### First load on a new device

The mirror is empty and the SDK cache is empty, so **online, the first paint is the App shell with
nothing in it, then the full corpus lands in one `onSnapshot` and is written in one IndexedDB
transaction.** Offline, the session survives (ticket 08) but there is genuinely nothing to show;
this is inherent to a new device and no design avoids it.

What the design must avoid is confusing that with an empty account. A `meta` object store carries
**`initialSyncCompletedAt`** — set once, when the first snapshot for this uid has been applied.
Empty mirror plus unset flag renders *loading*; empty mirror plus set flag renders the genuine
first-run empty state. Without that one field the two are indistinguishable and a new device shows a
brand-new user's welcome screen over a corpus that is still downloading.

The app **never blocks on the first snapshot** on subsequent opens: it renders from the mirror
immediately and lets the snapshot reconcile in, under 02's rule that a snapshot updates clean Notes
and never touches a dirty one.

### Cross-tab coherence: BroadcastChannel, no leader election

02 established multi-tab correctness is already handled by the token design, so what is left is a
second tab showing stale text. **After any local mutation, post `{noteId}` on a `BroadcastChannel`;
receiving tabs re-read that one row and refresh their in-memory copy.** Roughly fifteen lines, no
protocol, and no failure mode — a dropped message leaves a tab stale until the next snapshot, which
it is subscribed to anyway.

**Web Locks leader election is rejected** as premature: 02 explicitly relieved it of correctness
duty, and its only remaining benefit is halving Firestore reads for a user who keeps two tabs open,
which is not a problem we have.

One case degrades and is accepted knowingly: **the same Note open and being typed into in two tabs
at once resolves last-save-wins with no Conflict copy**, because it is one mirror row and one Outbox
slot. Cross-device conflicts are preserved; this same-device one is not. The rule for the editor is
that an invalidation for the Note it currently holds is applied only when that editor has no
unsaved buffer — otherwise it is ignored and the later save wins. Making this safe means per-Note
locking or treating tabs as devices, which is real machinery for a self-inflicted scenario.

### Size, eviction, and the one thing that must not be skipped

At ~2 kB a Note, a thousand Notes is a couple of megabytes: IndexedDB quota is not the binding
constraint and there is **no eviction policy at MVP**. The constraints bind in this order, and all
three are ticket 06's and the growth story's, not this one's: Firestore reads per app open, the
initial full download on a new device over mobile data, then the in-memory search scan. **Re-examine
at ~2,000 Notes or ~20 MB of mirror, whichever comes first.**

The non-negotiable part: **call `navigator.storage.persist()` on first successful sign-in.** Without
it IndexedDB is best-effort storage and the browser may evict it under disk pressure — and because
unpushed Outbox edits live *only* in the mirror, an eviction is silent loss of the user's offline
writing. Chrome weighs PWA installation and engagement when granting, both of which this app has.
It is one call, and it is the difference between durable offline edits and probably-durable ones. If
it is refused, or eviction happens anyway, the mirror rebuilds from the server on next open and only
unpushed edits are lost; that is the floor and it cannot be lifted further from the client.

**Confirmed by Badrish, 2026-08-25**: call it on first sign-in, and **sign-out keeps the Notes on the
device** (the per-uid database is retained, no wipe).

`persist()` returns a boolean and browsers may refuse — it is weighed on PWA installation and
engagement, so a plain tab is often denied where the installed homescreen app is granted. When it
returns false: **retry once per app open, silently, and show no warning.** A denial usually resolves
itself as engagement accrues, and a scary dialog about storage the user cannot act on is noise.
The one honest adjustment: while persistence is denied *and* the Outbox is non-empty, ticket 05's
sync strip drops its second clause and reads `3 notes waiting to sync` rather than
`· they're safe on this device` — because in that state the second clause is not quite true.

Tombstoned Notes stay in the mirror — the Trash view reads them. The 30-day purge remains unspecified
on the map and is not this ticket's.

### Testable seams for TDD

Named deliberately, because ticket 09 needs a substrate and most of it should not be the emulator:

- **`NoteStore` port** — `getAll`, `get`, `put`, `delete`, `runInTransaction`. One contract test
  suite, run twice: against an in-memory fake and against the real `idb` implementation. This is the
  seam that lets 09 simulate a second device as a second store instance instead of a second browser.
  It is the one abstraction here that is not premature; it exists because tests demand it.
- **`applySnapshot(localRow, serverDoc) -> localRow`** — pure. 02's two model-checked data-loss
  traps live entirely inside this function, which makes them ordinary unit tests.
- **`reconcile(srvRev, baseRev, pendingRev) -> action`** — pure, three equality tests, no clock, no
  I/O. The heart of 02 is testable with zero infrastructure.
- **Corpus projection** — `(corpus, filter) -> view` for list, Trash, and search. Pure array work,
  no browser.

That leaves the emulator responsible only for security rules and real transaction semantics.

### Consequences beyond this ticket

- **Ticket 06 is unblocked** and inherits a hard floor: search scans an in-memory array of the whole
  corpus, so no index needs building or maintaining, and the tripwire above is where that stops being
  true.
- **Ticket 01's deferred composite indexes are resolved as "none required."**
- **Ticket 09 is unblocked**, with the `NoteStore` contract-test seam as its substrate and the
  emulator narrowed to rules plus transactions.
- **Ticket 10 owes nothing new**; the cache setting is application code, not build config.
- No ticket is invalidated. No new ticket graduates from the fog — the growth story (search and
  mirror size at large Note counts) stays on "Not yet specified" with a number attached to it now.

## Amendment, 2026-08-26 — the server-clock watermark (Badrish)

Badrish asked why we can't have a server clock as the base clock we compare against. The question
lands on two different decisions and the answer differs for each.

**On 02's reconcile: no, and a server clock would be a regression.** Not amended. Concurrency is a
causality question, not a time question — two devices can write at distinct, correctly-ordered
server times and still be concurrent, so "later timestamp wins" is exactly the last-write-wins data
loss 02 exists to prevent. And a server-assigned value cannot serve as the identity token at all:
the push must know the token it is writing *before* the round trip, because that is what lets a
retry after a lost response recognise its own landed write (`srv.rev === pendingRev`) instead of
fabricating a Conflict copy of its own text. A value the server assigns is by definition unknown
until after the trip. This is the same failure that killed the counter, through a different door.
02's three equality tests stand unchanged, and `domain/` still reads no clock.

**On this ticket's rejected watermark: the objection I raised is genuinely dissolved.** The
rejection above is conditional on *client* clocks — "a device whose clock lags writes an
`updatedAt` beneath our watermark." A server-stamped field has one writer and one clock, so that
specific silent-loss path does not exist. Badrish is right about that, and the ticket's wording
above should not be read as ruling out the server-clock variant; it never considered it.

Shape it would take, if adopted — recorded so nobody re-derives it:

- A **new** field, e.g. `serverSeq: serverTimestamp()`, **not** a change to `updatedAt`. `updatedAt`
  stays client-stamped, because a server sentinel reads back null and 01 chose client millis for
  exactly that reason; `serverSeq` is a sync-layer field the UI and `domain/` never read.
- Security rules must pin it: `request.resource.data.serverSeq == request.time`. Without that a
  buggy client writing a low value makes its own document invisible to every future watermark query,
  permanently — the rejected trap re-entering by the front door.
- Watermark is `max(serverSeq)` over the delivered set, re-queried with `>=` and deduped. Safe under
  Firestore's commit-timestamp ordering, but that claim is **model-check-worthy before it ships**,
  not assertable from reasoning — it is the same class of claim as 02's snapshot rules, which were
  reasoned and turned out to be wrong.

**Still not adopted, and the reason is now a different one.** A filtered query never delivers
removals, so a hard delete elsewhere (Delete forever, or a purge) leaves that Note in our mirror
forever with nothing to correct it — silent divergence, which is the exact class of failure 02 and
03 spent themselves eliminating. Firestore's `persistentLocalCache` resume token solves the same
read-cost problem *and* delivers removals correctly, is a one-line reversal this ticket already
sanctioned, and needs no new field, no rules change and no proof. So the order of preference for
the read-cost problem is: measure first (Builder's step 7), then `persistentLocalCache`, and only
then a `serverSeq` watermark if the SDK cache is somehow unacceptable.

Retrofit cost, checked: adding `serverSeq` later is cheap. Existing documents would hold null, and
the migration is a single full re-read — which is exactly today's behaviour. So deferring this
carries no trap.
