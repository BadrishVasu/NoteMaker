# Conflict-copy mechanism under Firestore's offline queue

Type: grilling
Status: open
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
