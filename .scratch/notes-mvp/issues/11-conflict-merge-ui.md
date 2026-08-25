# Reviewing and merging a Conflict copy

Type: prototype
Status: open
Blocked by: 02, 05

## Question

Ticket 02 guarantees that a Conflict copy exists, is durable, and carries everything a merge needs —
`conflictOf` pointing at its surviving sibling and `conflictBase` holding the fork-point content, so
a true three-way merge is available on either device. It deliberately stops there. This ticket
decides what the user actually sees and does.

Settle: how a user notices a Conflict copy exists at all, given 02 rules out any marker in the title
string and any blocking dialog in the sync path — a badge in the list, a banner on the Note, a count
somewhere, or something else. What the merge surface looks like: per-hunk accept/reject like a diff
review, or a simpler side-by-side pick-a-side that covers most real cases for a tenth of the work.
What granularity a hunk is for markdown prose — line, paragraph, or block. What completing a merge
does to the two Notes: the merged result lands on the surviving sibling and the copy is deleted, or
something less destructive. What happens if the user never resolves it and simply keeps both, which
must remain a first-class outcome rather than a failure.

This is a `prototype` ticket, not a grilling one: "how should this look and behave" is the question,
and the cheapest way to answer it is a rough artifact to react to rather than another round of
discussion.

## Handed down from ticket 02

- **The editor follows the content, not the id.** Under the server-survives rule the reconciling
  device's text moves to the Conflict copy, so an open editor must redirect to the copy at the moment
  reconciliation runs. Without that, the user's cursor lands mid-sentence in the other device's text.
  This is a hard requirement on this ticket, not a nicety.
- **No automatic three-way merge, ever.** A silent text interleave has no test oracle. Every merge is
  user-driven.
- **Nothing here may sit in the sync path.** The automatic Conflict copy is the floor and must always
  complete without user involvement; this ticket is a layer strictly on top of it.
- A Conflict copy is an ordinary Note in every other respect — it syncs, it is searchable, it can be
  edited, and it can be deleted like any other.

## Origin

Badrish proposed the interactive merge during ticket 02, as a resolution step at reconnect time.
Ticket 02 kept the provision and moved the timing: see its answer for why an interactive step cannot
live in the sync path.
