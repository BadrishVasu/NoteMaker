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
