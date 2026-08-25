# Local store: Firestore's built-in persistence alone, or a Dexie mirror

Type: grilling
Status: open
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
