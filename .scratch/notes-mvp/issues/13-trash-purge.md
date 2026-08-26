# The 30-day Trash purge

Type: grilling
Status: open — deferred out of the v1 slice by Badrish, 2026-08-26
Blocked by: nothing (but see "Not before the app runs")

## Why this ticket exists

Created by the `builder` agent, 2026-08-26, on Badrish's answer: *"30 day trash purge can be
ticketed properly as suggested."* The suggestion was mine, from the architecture readiness pass:
**no purge at all in v1** — the Trash simply grows, which costs nothing at this corpus size — and a
proper ticket rather than an improvised implementation.

Until now the purge existed only as a promise in the UI and a line of fog on the map. Ticket 05's
Trash empty state names it, and the read-only banner on a trashed Note tells the user in so many
words that *"It's purged 30 days after deletion."* **Nothing implements that sentence.** So the
product currently either has to build it or stop saying it, and this ticket is where that is
decided rather than discovered.

## The reason it is not a small task

A purge is a **hard delete**, and it is the only Note write in this entire design that is not an
edit. That makes it the one operation that can quietly punch a hole in ticket 02's central
invariant — *every Note write goes through `runTransaction`, through the one gateway file*. An
implementation that reaches for `deleteDoc` because "it's just a cleanup" reintroduces the whole
data-loss class through a door nobody is watching.

Three constraints are already fixed by closed tickets and are not this ticket's to relitigate:

1. **It routes through `sync/firestoreGateway.ts` like every other Note write.** The ESLint import
   boundary in [`architecture.md`](../architecture.md) means it physically cannot be written
   anywhere else; this ticket must not be the reason someone widens that boundary.
2. **The mirror must never purge locally ahead of the server.** Ticket 03's mirror is rebuilt from
   snapshots; a row deleted locally while the server document still exists is resurrected on the
   very next snapshot. Deletion flows server-first, and the local row goes when
   `applySnapshot` sees the document absent — which the Mathematician's table already covers
   (cells 3 and 7 in [02's appendix](02-conflict-copy-mechanism.md)). **Cell 7 is the interesting
   one and this ticket must respect it**: a *dirty* row whose server document has vanished is a
   no-op — the row and its unsent edit are kept. A purge must not be able to eat an edit the user
   made offline on another device.
3. **`deletedAt` is client-stamped** (ticket 01), so "30 days" is measured against a clock that can
   be wrong. This is the one place in the product where a clock actually decides whether data is
   destroyed, and 02 spent itself removing clocks from the sync path precisely because they are not
   trustworthy. That tension is the heart of this ticket.

## What must be settled

- **What triggers it.** Client-side on app open is the obvious answer and it is the map's own open
  question. It means the purge only runs on a device the user opens — a corpus can sit un-purged
  indefinitely, and two devices can race the same purge. The alternative is a scheduled Cloud
  Function, which is real infrastructure this project has otherwise avoided entirely, and which
  needs a billing-enabled project.
- **Whether the 30 days is even enforced, or only promised.** A serious option: keep the Trash
  forever, and change the two strings in ticket 05 so the product stops claiming a purge it does not
  perform. The corpus is one person's notes; a tombstoned Note costs ~2 kB. This may be the correct
  answer, and if it is, this ticket closes by deleting a sentence rather than by writing code.
- **Whose clock decides.** If a purge is destroying data on a 30-day threshold, a skewed client
  clock destroys it early. This is exactly where the `serverSeq` idea from
  [03's amendment](03-local-store-choice.md) could genuinely earn its place — a server-stamped
  field is trustworthy in a way `deletedAt` is not. Do not assume that; reason it out.
- **Whether the user can empty the Trash themselves.** A manual `Delete forever` is a hard delete
  with the same constraints, minus the clock — and it may be all this feature ever needed.
- **What the user sees.** Notes disappearing on their own is the kind of thing that reads as a bug
  even when it is the documented behaviour.

## Not before the app runs

This ticket is unblocked but it is **not the frontier**, and the ordering is deliberate: the
destination is a running app, and the Trash growing without bound is not a problem any user of this
product will have before it is deployed, used daily, and re-examined. Slot it after build step 7,
alongside 06 / 11 / 12.

## Owner

Unassigned. The clock question is the part that would repay the Mathematician's attention — it is
the only decision in the product where getting a comparison wrong destroys user data outright.
Do not settle it by intuition inside an implementation.
