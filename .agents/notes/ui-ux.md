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
