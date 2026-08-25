# Android back-button and history behaviour

Type: grilling
Status: open
Blocked by: 05

## Question

The app is a single-page app installed to the Android homescreen, where the system back gesture is
the primary navigation control and has no browser chrome around it to soften a mistake. Backing out
of the app when the user meant to leave the editor is the kind of thing that gets a notes app
uninstalled.

Ticket 05 made this concrete enough to ticket by settling the shell it has to operate on: a
master-detail layout that pushes list to editor on phone, Trash as a mode rather than a separate
place, and a deliberate `replaceState` when the conflict redirect swaps the open Note underneath the
user.

Settle: what each history entry actually is, and which transitions push versus replace — list to
editor, editor to list, entering and leaving Trash, opening search and clearing it. What back does
from the top-level list, given that on an installed PWA the next back exits the app entirely, and
whether that needs a confirm or a double-press. Whether the phone editor is a route with its own URL
or a state, and what that means for deep links and for restoring position when Android kills and
restores the app. How the debounced save interacts with a back gesture, given 05's rule that saves
must flush on `blur`, `visibilitychange` and `pagehide`. Whether the desktop browser's back button
should behave identically or differently, since the same code serves both.

## Handed down from ticket 05

- **The conflict redirect must not create a history entry.** When reconciliation moves this device's
  text to a Conflict copy, the open editor swaps documents silently via `replaceState`; a back press
  afterwards must not walk the user into the Note they were displaced from.
- Saves are debounced with mandatory flushes on `blur`, `visibilitychange` and `pagehide` —
  Android backgrounding otherwise eats writes. Any history design here must not introduce a fourth
  path out of the editor that skips the flush.

## Origin

Graduated from the map's "Not yet specified" fog by ticket 05, which made it sharp. The rest of that
fog entry — Android share-target intent — has not graduated and stays in the fog.
