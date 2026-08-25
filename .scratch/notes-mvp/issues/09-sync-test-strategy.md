# Test strategy for offline sync

Type: grilling
Status: open
Blocked by: 02, 03

## Question

TDD is mandatory here, and the interesting behaviour — two devices, one offline, a conflict on
reconnect — is precisely the behaviour that is hardest to write a failing test for first.

Settle: whether the Firebase Emulator Suite is the test substrate, or the sync layer is written
against an interface that a fake implements. How a second device is simulated — a second SDK
instance, a second browser context, or a pure unit-level model of the sync loop. How going offline
and coming back is triggered deterministically in a test. Which cases are non-negotiable coverage:
clean sync, a conflicting edit producing a Conflict copy, a delete racing an edit, and a Tombstone
failing to resurrect. Where the line sits between unit tests of the sync logic and end-to-end tests
of the app.

Depends on tickets 02 and 03: there is nothing to test until the mechanism and the store are
settled.

## Handed down from ticket 02

- **This ticket owes a test that no `setDoc` or `updateDoc` is ever called on a Note.** The entire
  mechanism rests on every Note write going through `runTransaction`; one stray direct write anywhere
  in the codebase silently reintroduces the whole bug class, and it would not fail any ordinary
  feature test.
- Two failure modes worth targeted cases, both found by model-checking rather than by reasoning and
  both silent data loss: the fork point advancing after a delete loses a conflict, and an incoming
  `onSnapshot` advancing the fork point or overwriting a dirty Note's local body.
- Reconciliation is **clock-free** — it is three equality tests on an opaque token — so tests never
  need to control or skew time, only to control interleaving. That removes what would have been the
  hardest part of writing these tests deterministically.
- 02's own model-checking spike covered two devices, no user edits to a Conflict copy mid-run, and no
  purge. Those three gaps are where this ticket's coverage is most load-bearing.
