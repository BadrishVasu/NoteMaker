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
