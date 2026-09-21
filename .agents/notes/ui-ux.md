# ui-ux — notebook

My own working thoughts on NoteMaker. Others read; nobody else edits.

## 2026-08-25 — ticket 05, editor and app-shell UX

First time on this project. Read 01, 02, 11, CONTEXT.md, the map.

### The thing that reframed the whole ticket

Ticket 02 kills `navigator.onLine` — "no online-detection code at all". My instinct was an
Offline badge in the header; **that badge cannot be built honestly**. The app does not know the
network state and deliberately never asks. What it knows is per-Note: has the server accepted
*this exact text*? That is the Outbox. So every sync affordance in this design is a statement
about a Note, not about the network. This inverted my first draft and is the decision I am most
confident about.

Corollary I nearly got wrong: a global "Offline" strip is fine *if* it is worded as
"N notes waiting to sync" — that is Outbox state, and it is true whether the cause is no network,
a dead server, or a rules rejection. Do not word it as a network claim.

### Title latch — why the placeholder trick works

`titleIsCustom` maps exactly onto "does this input have a value". Derived => input value is empty
and the derived string is the *placeholder*; Custom => input value is the string. Grey vs solid
text then teaches the latch without a tooltip, and the first keystroke is the latch. One input,
no mode switch, no extra state.

The edge that needs words: Custom + emptied. The user's natural read of "I cleared the title" is
"go back to following the body", and 01/CONTEXT say it must not. So that exact state gets an
inline line of text. It is the only place I spend copy on the latch.

### Dead ends, recorded so nobody re-walks them

- **"Offline" badge / network status chip.** Dead. See above. Nothing in the architecture can
  source it.
- **A "follow the first line again" unlatch action.** Contradicts CONTEXT.md's Custom title, which
  is one-way by definition. I did not design it; I raised it to Badrish as a confirm-only question
  rather than deciding it against a settled term.
- **Discarding an untouched new Note when the user leaves the editor.** Rejected. 01 writes the
  document from birth with a real Default title, precisely so nothing is held in memory untitled.
  Discarding means pushing a delete for a Note the server may already have — machinery to undo the
  user's own tap. Empty Notes are cheap; the user deletes them.
- **Split-pane live preview on desktop, toggle on phone.** Not dead, but it is two layouts and two
  code paths for a preview a markdown author rarely reads while writing. Put to Badrish as variant
  B of the prototype rather than decided by me.
- **Blocking typing at the 1 MiB Firestore cap.** Dead — refusing keystrokes is the one thing a
  notes app may never do. The local mirror (ticket 03, ours, uncapped) holds it; the *sync* is what
  fails, and it fails visibly.

### Badrish's reactions — and the one I got wrong

He cut the Write/Read pair outright: "there's only going to be one by default which is Write." I had
treated a rendered view as obviously worth a persistent control; he read two co-equal modes as the
app being pleased with itself. He's right, and the tell is that "Read" was a mode you could get
*stuck* in — the note is the text, so the editor should be where you always are. Preview demoted to
an invoked action. Split-pane died with it, which is tidy: it was only ever the alternative to a
two-mode editor.

He also overruled me and Claude both on the title latch — no escape hatch, "if the user removes the
original autofill, it's gone for the note." Noting it because I'd recommended keeping it one-way
*and* still half-expected to be asked for an undo later. Don't add one without him.

### Manual save — the trap that isn't obvious

He asked for a manual-save vs auto-save setting. The literal implementation puts unsent text back in
a textarea, which is the exact loss 02 and 03 were built to remove. The honest version separates the
two things that happen on a keystroke: **write to the mirror** (durability) and **enter the Outbox**
(visibility on the other device). The setting gates the second only. Implementation-wise that is one
deferral — mint `pendingRev` at button-press instead of edit-time — and every one of 02's invariants
survives.

**The bit I nearly missed, and the reason this needed the Mathematician rather than my say-so:** 02
says a snapshot must never overwrite a *dirty* Note's body, and 03 defines dirty as
`pendingRev !== null`. A manually-unsaved Note is `pendingRev === null`, so the other device's
snapshot would overwrite the user's unsent paragraph while they were looking at it. The guard
predicate has to widen. A whole safety architecture, defeated by a settings toggle nobody would
think to re-verify. Raised to Badrish rather than built.

### Boundary I had to hold

Ticket 11 owns the merge surface and how a Conflict copy is *noticed*. I own the redirect
mechanics only — the silent swap, cursor preservation, `history.replaceState`. I reserved a
badge slot in the list row and left the badge itself to 11. Resisted designing the compare view
even though the prototype felt thin without it.

### Ticket 03 closed while I was stopped, and it improved my cold start

03's `initialSyncCompletedAt` is exactly the distinction I needed: **a new device downloading is not
an empty account**, and they are two different screens. Before reading 03 I had one generic skeleton
covering both, which would have shown "No notes yet" to a user whose corpus was still in flight —
the worst possible lie for this app to tell. Split into three states (downloading / downloading with
no network / genuinely empty) and added scenario buttons for each.

Second gift from 03: the whole corpus is in memory and the mirror is read at open, so **a returning
device has no loading state at all**. The full re-read 03 accepted as a price is invisible — it
happens behind an already-usable list. I nearly designed a spinner for it.

Also held off the map's fog: list ordering, pinning, first-run onboarding, Android back button.
I designed only the states the shell physically cannot render without (cold start, empty list,
sign-in failure offline) and said so out loud on the ticket. The back-button one is now sharp
enough to ticket and I flagged it up.

## 2026-09-18 — step 6, ticket 05 → `.scratch/notes-mvp/design/05-screens.md`

Turned the resolved ticket into a component-by-component spec Frontend builds from directly:
`AppShell, NoteList, SearchField, Editor, TitleField, EmptyStates, SyncStrip, TrashView`, the
conflict banner, and a minimal `SignIn`. Read `src/domain/note.ts` and `title.ts` first so props
are named against real types, not invented fields.

**The two placements handed to me:**
- `Sync Now` → list header (icon button next to the overflow menu), on both desktop pane and
  phone home screen. It drains the whole Outbox, not the open Note, so it belongs on the one
  chrome that's present on every screen — not the editor toolbar, which disappears the instant
  nothing is open and would misread as "sync this Note."
- `Auto sync` → a toggle row in the list header's overflow menu, next to Trash and Sign out —
  the one place in this app that already behaves like a settings menu. No dedicated settings
  screen for one boolean.

**A real gap I found, not just handed context: `resolveTitle` runs at save time, so
`LocalNote.title` is already the resolved string on a clean row.** Nothing in ticket 05 or the
prototype says this explicitly — the prototype recomputes `derivedFrom(body)` live in the DOM
layer, which is fine for a throwaway but would be wrong production advice (double-deriving,
disagreeing with the stored value if a save is in flight). Spec says `TitleField`'s placeholder is
literally `note.title` when `!titleIsCustom`, not a recomputation. Recorded so Frontend doesn't
copy the prototype's shortcut.

**Underspecified in ticket 05, flagged in the spec itself:** the three `SyncStrip` states are
each given ("one sentence each") but never ordered against each other — what shows when
`persistDenied` and `autoSync === false` are both true at once with a non-empty Outbox. I picked
persist-denied as the higher-priority state (bare "N notes waiting to sync.", no "Sync now"
clause) because appending an action there would wrongly imply tapping it removes the eviction
risk, which it doesn't. This is a judgment call, not a restatement of something settled — flagging
it up in case Badrish or Builder reads it differently.

**Also newly precise, not a decision:** the "Custom but emptied" title hint needs a live-computed
`untitledPreviewN` (via `nextUntitledN` over current mirror titles) so the copy never lies about
which `Untitled Note N` the field will actually resolve to on save. The ticket's example copy
just says "4"; I made the number a real prop rather than a hardcoded string.

No dead ends this session — the ticket was thorough enough that turning it into a spec was
mostly transcription plus naming real props, not re-deciding anything.

**Addendum, same day — Builder's two rulings folded in.** He overturned my SyncStrip priority
order: the reassurance and action clauses are independent, not ranked, so it's four explicit
states, not three with a tiebreak. His reasoning is better than mine — `Sync now` is an action,
not a reassurance, so dropping the reassurance under `persistDenied` doesn't reach it, and the
user most at eviction risk is the one who least benefits from a strip that states a problem and
offers nothing. Rewrote §7 with all four cells spelled out. Also pointed §4's too-large check at
his new `src/domain/size.ts` `exceedsSyncLimit` (real UTF-8 bytes, not my UTF-16-proxy shortcut —
he's right that it under-counts emoji/CJK exactly where the threshold matters most), and scoped
`Preview`'s markdown subset to his hand-rolled, no-dependency, `dangerouslySetInnerHTML`-free
list. Nothing of mine survived unchanged in §7; worth remembering that "flag it and let someone
with more context rule" beat guessing at a priority order myself.

## 2026-09-21 — step 7, three rulings for real auth/sync

Read the Mathematician's 2026-09-21 amendment to ticket 02 first (the editor buffer is a dirty
row). Three calls from Builder, folded into `05-screens.md` directly rather than kept here:

**1. Re-seeding an idle open Note on a remote edit.** The Mathematician's rule 5 makes this safe
only when the buffer equals base and nothing is queued/in flight — that's the condition, not my
call. My call was the UX treatment: **silent, no notice, treated as a remount** (new textarea
value, caret to 0, scroll to top, selection discarded, focus never stolen from wherever it
already was). Leaned on a rule I'd already established in the first session — this app has zero
toasts/spinners/error dialogs anywhere, and a closed Note's row already updates from a remote edit
with no announcement, so an open idle Note updating the same way is consistency, not a new kind of
surprise. Explicitly distinguished from §9's conflict-redirect (there the *text* never changes,
only the id underneath it) since Builder was right to flag they're different events — this one
needed its own caret/scroll/selection answer, not a borrowed one. When `canReseed` is false
(something typed and either queued or in flight), did **not** add a "this note has unsynced
remote changes" notice — nothing actionable for the user to do with that information before their
next keystroke resolves it as a Conflict copy anyway.

**2. Storage failure copy.** Confirmed Builder's Day-7 wording as-is — accurate, terminal, and the
one action offered (reload) is the one actually likely to help. Added it as a proper spec state:
full-screen replacement of the whole shell (not a strip), reached after sign-in succeeds since the
per-uid database only exists once the uid is known, one `Reload` button, deliberately no sign-out
option (the failure is device-local storage, not the account — offering sign-out would misdirect
the user toward the wrong fix).

**3. Sign-in outcomes.** Agreed with both of Builder's proposals (popup-closed-by-user → nothing,
button just sits there; the auth-unknown instant → render nothing rather than a splash, since a
splash for a sub-100ms gap either flashes illegibly or adds a floor to every app open to justify
its own existence). Added two things he hadn't asked for but the outcome space needed: distinct
copy for the browser-blocked-the-popup case (telling the user to fix their browser, not to just
retry, since retrying identically reproduces the block), and a generic fallback line for any other
rejection Firebase might throw that isn't named in 05 — reusing the same copy slot as no-network,
never shown alongside it, so there's no unbounded set of ad-hoc error strings waiting to be
invented under time pressure later.

No dead ends this session — all three were direct rulings, not investigations that hit a wall.
