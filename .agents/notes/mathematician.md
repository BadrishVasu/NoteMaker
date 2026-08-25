# mathematician — notebook

## 2026-08-25 — manual-send re-check against ticket 02's proof

Asked to verify UI/UX's suspected break in the snapshot-overwrite guard once a manual-send
setting was added. Read `02-conflict-copy-mechanism.md` in full, `.agents/notes/ui-ux.md`, and
`.agents/features/editor-and-shell.md`.

**Finding:** the break is real under the implementation UI/UX had sketched (mint `pendingRev` at
send-press instead of edit-time — see their notebook, "Implementation-wise that is one
deferral"). That plan makes a mid-typed, unsent Note look clean (`pendingRev === null`) to the
snapshot guard, which then overwrites it on an incoming remote edit. Traced the exact
interleaving; it's the same bug class the guard exists to stop, reintroduced by conflating two
things 02 never conflated: "recorded in the Outbox" and "about to be pushed."

**Fix, not a widening of the guard:** keep minting `pendingRev` at edit time unconditionally (as
02 already specifies) in both modes. Gate only the push *attempt* — the `begin-push` trigger — on
the manual-send setting and the send press. `pendingRev !== null` remains the correct dirty
signal and the guard is untouched. This is the opposite of UI/UX's candidate one-liner: their
plan was the bug, not the fix.

**Why no re-run of the model check was needed:** `begin-push` was already nondeterministic in the
2.4M-interleaving check — traces where it's deferred arbitrarily relative to `edit` are already
inside the checked set. Manual send only restricts which schedules can occur (user-gated instead
of debounce-gated); restricting a schedule set is safety-preserving for any property already
proven over the superset. Recorded this as the general pattern: a UI-level "when to trigger the
async push" setting never needs re-verification against 02 as long as it only changes *when*
`begin-push` may fire, never *what* it does or *what governs dirtiness*. A setting that changes
dirtiness computation (e.g. anything that would make `pendingRev` not track "has unconfirmed
local content") does need re-verification — that's the tripwire to watch for on this ticket going
forward.

Wrote the amendment directly into `02-conflict-copy-mechanism.md` since it's my ticket's
mechanism. Nothing in 02's document schema, transaction, or guard changed.
