# Editor and app-shell UX

Type: prototype
Status: resolved

## Question

What does the app actually look like, on a phone and on a desktop browser?

Raise the fidelity of the discussion by building something rough to react to rather than describing
it. Cover: the Note list and how a Note is opened; the editor itself — is markdown typed as markup
with a separate preview, split-pane, or rendered inline; how a new Note is created and how it is
saved (explicit save versus continuous); where search lives; how Trash is reached; how sync state
is surfaced, if at all, and what the user sees when offline.

Use the `prototype` skill and link the artefact from this ticket. This is HITL: the reactions are
Badrish's, and the agent never stands in for his side of it.

## Constraints from ticket 01

The title behaviour is already settled and the prototype must honour it rather than re-invent it:

- Every Note starts **Derived titled** — the title follows the first non-empty line of the body,
  markdown heading markers stripped, truncated to 100 characters.
- The moment the user types in the title field the Note becomes **Custom titled**, and this is a
  **one-way latch** — emptying the title afterwards does not restore derivation.
- A title is mandatory. A Note with nothing to derive from and no custom title falls back to the
  **Default title** `Untitled Note N`. The Default title does not latch.

What is still this ticket's to decide: how the title field is presented so the latch is
discoverable rather than surprising, and whether the user is shown anything when a Default title is
assigned.

## Answer

Prototype: [`prototypes/05-shell/index.html`](../prototypes/05-shell/index.html) — throwaway, single
file, no build step, double-click to open. Three structurally different shells on `?variant=A|B|C`,
plus scenario buttons for the states that are hard to picture on paper (new device downloading, new
device offline, empty account, Outbox pending, the conflict redirect, sign-in with no network) and a
phone/desktop frame toggle. It talks to nothing; all state is in memory.

### The decision that reframes the rest: the app has no concept of "offline"

Ticket 02 removed online detection entirely — `navigator.onLine` is never consulted. So **an
"Offline" badge cannot be built honestly**, and this design does not contain one. What the app knows
is per-Note and comes from the Outbox: *has the server accepted this exact text?* Every sync
affordance here is therefore a statement about a Note, never a claim about the network.

- **In the editor**, a quiet status in the toolbar: `Saved` when clean, `Saved on this device` when
  the Note is in the Outbox. Never a spinner, never a toast, never an error dialog.
- **In the list**, a small amber dot on rows in the Outbox. Nothing else.
- **Globally**, when the Outbox is non-empty, one quiet strip at the bottom of the shell:
  `3 notes waiting to sync · they're safe on this device`. It is worded as Outbox state precisely
  because that sentence stays true whether the cause is no network, a dead server, or a rejected
  write. It never escalates, never blocks, and has no retry button — retry is automatic backoff.

A failed push is not an error the user must act on. The only thing they could do about it is connect,
and the strip already says so implicitly.

### Shell and navigation

**Variant A, master-detail**, is the recommendation and what the prototype opens on.

- **Desktop (>760px):** a persistent 340px list beside the editor. `New note` is a button in the list
  header. Selecting a row swaps the editor pane; the list never scroll-jumps under the user.
- **Phone:** two screens. The list is the home screen with a `+` FAB bottom-right; tapping a row
  pushes a full-screen editor with a back arrow. No side-by-side anything.

Variants B (editor-first with a list drawer) and C (two full screens on both form factors) are in the
prototype as the honest alternatives. B is the one to look at if the phone is overwhelmingly the
primary device; C is the one to look at if a single code path with no breakpoint is worth more than
desktop screen real estate.

### The editor

- **Markdown is typed as markup** in a plain monospace `<textarea>`. No WYSIWYG, no contenteditable.
  Rationale beyond simplicity: ticket 11's merge operates on markdown source, and a rendered-inline
  editor would make the merge surface disagree with the editing surface.
- **There is one mode, and it is Write.** Badrish rejected the `Write`/`Read` segmented control: the
  app should not present two co-equal modes. The editor is the note. **Preview survives only as an
  invoked action** — a `Preview` button in the toolbar that renders the markdown read-only and is
  dismissed back to the editor. It is not a mode, it is not persisted, and it is not where you land.
  No split-pane on any form factor. *(Reversible: if the preview turns out to be dead weight in daily
  use, deleting it removes one button and one render path and touches nothing else.)*
- **Saving is continuous and debounced ~600ms**, title and body in the same write per ticket 01. The
  save **must also flush** on editor unmount, on `blur`, on `visibilitychange → hidden`, and on
  `pagehide` — on Android the app is backgrounded far more often than it is closed, and a debounce
  timer that never fires is lost writing. There is no "Saved!" toast; the toolbar status is the whole
  feedback. **On top of this there is a `Sync Now` button and an `Auto sync` setting — see
  "Sync Now and Auto sync", settled by Badrish 2026-08-26.**

### The title field, and the latch

`titleIsCustom` maps exactly onto one question: *does this input have a value?*

- **Derived (or Default):** the input's **value is empty** and the resolved title is its
  **placeholder**, rendered muted and italic. Below it, one line: *"Following the first line of the
  note. Type here to name it yourself."*
- **The first keystroke in that field is the latch.** Value becomes real, text becomes solid black,
  the hint disappears. Grey-versus-solid teaches the latch without a tooltip or a mode switch.
- **Custom but emptied** is the one state that needs copy, because clearing the title is exactly what
  a user does when trying to undo the latch. That state shows: *"This note keeps its own title now —
  clearing it doesn't go back to following the first line. It's listed as* Untitled Note 4.*"* This is
  the only place the design spends words on the latch, and it is spent where the user is already
  wrong.

**The latch is one-way and gets no UI escape hatch.** Settled by Badrish, 2026-08-25, against the
recommendation ui-ux and Claude both put to him: *"let's not make our app too smart. If the user
removes the original autofill, it's gone for the note."* So the inline line above is the entire
treatment — it explains, it does not offer a way back. Do not add an "un-latch" or "follow the first
line again" action later without reopening this with him.

**A Default title is never announced.** No toast, no dialog. It is simply *visible*: as the field's
placeholder, and in the list rendered muted and italic so a list of them doesn't read as four notes
the user deliberately named `Untitled Note N`. "Is this a Default title" is computed from
`!titleIsCustom && no derivable first line` — never by regex-matching the stored string.

**A new Note focuses the body, not the title.** Every Note starts Derived; focusing the title field
would nudge the user across the one-way latch on every single creation.

**An untouched new Note is kept, not discarded.** Ticket 01 writes the document from birth with a real
title exactly so nothing is held in memory untitled; discarding would mean pushing a delete to undo
the user's own tap. Empty Notes are cheap and deletable.

### Search and Trash

- **Search is always-visible** at the top of the list — a field, not an icon that expands. It filters
  the list in place as you type. **Placement only is decided here; matching, ranking and scope are
  ticket 06.**
- **Trash is reached from the list header's overflow menu.** It reuses the list screen in a Trash
  mode: same rows, `deleted 2d ago` in place of the timestamp, empty state naming the 30-day purge.
- **Opening a trashed Note opens it read-only**, with a banner: *"This note is in the Trash and can't
  be edited. It's purged 30 days after deletion."* and a `Restore` action. Read-only is deliberate —
  editing a Note that carries a Tombstone would drive it into ticket 02's delete-lost branch and
  resurrect it by a side door. Restore first, then edit.

### The conflict redirect — ticket 02's hard requirement

When reconciliation moves this device's text to a Conflict copy, the editor follows the **text**:

1. **Not one character on screen changes, and the selection is preserved exactly.** The document
   identity swaps from `noteId` to the copy id under the user; the visible state does not move. This
   is the entire point of the requirement and it is a hard rule, not a nicety.
2. The URL updates with **`history.replaceState`, never `pushState`** — otherwise Back returns to an
   id that now holds the other device's text, which is the same bug through a different door.
3. A **non-blocking, dismissible banner** appears above the editor: *"This note was edited on another
   device too. You're still in your version — the other one is kept separately."* with one action,
   `Compare`. Nothing modal, nothing that can strand a write.
4. The list must not re-sort the open Note out from under the user during the swap.

The `Compare` action and the design of the badge that marks a Conflict copy in the list are **ticket
11**, deliberately not decided here. The list row reserves a badge slot next to the title (visible in
the prototype as a dashed `badge → t11` placeholder) so 11 has somewhere to land without relayout.

### The states the shell cannot render without

Only these. Broader first-run onboarding stays fog — see below.

- **App open with a populated mirror** (ticket 03: whole corpus in memory): the list renders
  immediately from the mirror. There is **no loading state on a returning device**, and the full
  corpus re-read 03 accepted happens invisibly behind an already-usable list.
- **New device, downloading** (`initialSyncCompletedAt` unset, per 03): *"Getting your notes… This
  device is downloading your notes for the first time."* This is a **different screen** from an empty
  account and the two must never be confused — that is what the flag exists for.
- **New device, no network:** *"Waiting for a connection. This device hasn't downloaded your notes
  yet."* Honest, and not an error.
- **Genuinely empty account** (`initialSyncCompletedAt` set, corpus empty): *"No notes yet.
  Everything you write is saved on this device first, then synced."* plus one primary button.
- **No search results:** names the query back, states that search covers titles and note text.
- **Sign-in with no network:** `signInWithPopup` fails; show *"Can't reach Google to sign in. Check
  your connection and try again — nothing is lost."* Never an infinite spinner. Per ticket 08 the UI
  gates on auth state, never on tokens, so a returning signed-in user never sees this screen offline.

### Body size (ticket 01 handed this to the editor)

**Typing is never blocked.** Refusing keystrokes is the one thing a notes app may not do, and ticket
03's mirror is ours and uncapped. It is the *sync* that fails and it fails visibly: past the
threshold the Note shows a persistent strip — *"This note is too large to sync. Shorten it to
sync."* — and stays out of the Outbox's clean state until it fits. It will never happen; it costs a
few lines and the alternative is a silent commit-time failure.

**Corrected 2026-08-26 (`builder`): the threshold is ~450 KiB, not ~1 MiB.** The original number
came from Firestore's 1 MiB document cap applied to a Note's own body, and it is wrong for every
Note in this app. A Conflict copy under ticket 02 carries **its own content plus `conflictBase`, the
fork-point content, in one document** — so a Note that conflicts needs roughly twice its own size to
land. A 600 KiB Note is fine until the day it conflicts, at which point the copy exceeds the cap,
the transaction fails permanently, the Outbox never drains, and the user's only signal is the strip
at the bottom of the shell reassuring them their notes are safe on this device.

Since any Note can conflict, the visible threshold must be the conflict-safe one: **~450 KiB of
combined title and body**, leaving headroom for the document's other fields. One number, and it is
the whole difference between a visible failure the user can act on and a silent stuck one they
cannot see.

### Settled with Badrish, 2026-08-25

He reacted to the prototype. In his words, lightly split:

- **No two-mode Read/Write framing.** *"There's only going to be one by default which is Write."*
  Folded in above. The split-pane question dies with it — it was the alternative to a two-mode
  editor, and there is no longer a two-mode editor to be an alternative to.
- **The title latch stays one-way, no escape hatch.** *"No, let's not make our app too smart. If the
  user removes the original autofill, it's gone for the note."*
- **The `N notes waiting to sync` strip stays.** *"Let the strip be."*
- **Body focus on a new Note, and keeping untouched new Notes** — both confirmed. *"Focus on the body
  is ok, makes logical sense. Untouched new note is kept."*

### Sync Now and Auto sync — settled by Badrish, 2026-08-26

His words: *"We can have 'Push now' and auto push. Just rename to 'Sync Now' and auto sync."* And to
UI/UX, as a standing naming instruction: *"Make the button 'Sync Now', other autosave options would
be called auto sync then."*

**The naming is binding across every artifact and every surface.** The button is **`Sync Now`**. The
setting and everything in its family is **`Auto sync`**. Nothing in this product says "push" or
"manual save" to a user — those are our words for our mechanism, and the user's word for the thing
is sync. Where an older section of this ticket, `map.md`, or `architecture.md` still says *manual
save* or *push*, it means this.

**What ships:**

1. **`Sync Now`** — a button, always present regardless of the setting, that forces an immediate
   Outbox drain. It bypasses the debounce and resets the backoff timer. With Auto sync on it is
   simply an impatience affordance; with Auto sync off it is the only thing that sends.
2. **`Auto sync`** — a setting, **on by default**. On, the engine drains the Outbox on its normal
   wake sources. Off, the engine drains **only** on `Sync Now`.

**What does not change, which is the whole point of taking this shape.** `pendingRev` is minted at
edit-time **unconditionally, in both settings** — the Mathematician's fix, recorded as the
manual-send amendment on [ticket 02](02-conflict-copy-mechanism.md). The setting gates the
`begin-push` *trigger* and nothing else. So:

- 02's snapshot guard predicate stays exactly `pendingRev !== null`. It does **not** widen. The trap
  that ui-ux caught — the other device's snapshot overwriting an unsent paragraph while the user
  looks at it — cannot occur, because an edited Note is dirty from the keystroke in both settings.
- 03's "the Outbox is a column" survives. No second stored field, no content hash, no `synced`
  boolean.
- **Everything is already durable in both settings**, and the copy must say so. A Note edited with
  Auto sync off is in the mirror, in the Outbox, and will survive a kill, a crash and a month
  offline. The setting controls when your words *leave this device*, never whether they are kept —
  which is exactly why it is not called "save".
- `blur` / `visibilitychange` / `pagehide` **force nothing extra in manual mode.** They flush to the
  mirror as always; they do not send. Durability was never gated by the flush.

**The one piece of copy this adds.** The bottom strip already reads `3 notes waiting to sync ·
they're safe on this device`. With Auto sync off that first clause is true but reads like a fault,
when it is the user's own setting doing exactly what they asked. So with Auto sync off and a
non-empty Outbox the second clause becomes the action: `3 notes waiting to sync · Sync now`, with
`Sync now` as the strip's tap target. (Note 03's third variant: while `storage.persist()` is denied
*and* the Outbox is non-empty, the reassurance clause drops entirely. Three strip states, one
sentence each.)

**UI/UX owns placement at build step 6** — where `Sync Now` sits in the editor toolbar versus the
list header, and where the `Auto sync` setting lives given this app has no settings screen yet. The
naming and the semantics above are settled and are not theirs to revisit.

### Superseded: the manual-save setting as originally read

He asked for *"a setting that has manual save or auto save - on change in text and on delay."* The
auto-save half is exactly what is specified above. The manual half is a genuinely new requirement and
it needs a precise reading before anyone builds it, because **the obvious implementation is the one
failure mode this entire map was engineered to remove.**

**Why "manual save" cannot mean what it means in a normal editor.** In a normal editor, unsaved text
lives in the widget and is lost if the app dies. Tickets 02 and 03 exist specifically so that never
happens here: text is durable the instant it is typed, in our own mirror, and survives a kill, a
crash, an eviction and a month offline. A manual-save mode in the literal sense would put a user's
words back in a `<textarea>` with nothing underneath — on Android, where the OS backgrounds and
reaps the app without warning, that is not a theoretical risk.

**The reading that gives him the control without the loss.** Two things happen when you type, and
only one of them is interesting:

1. The edit is written to the **local mirror** (ticket 03). This is what makes it durable.
2. The Note enters the **Outbox** and is pushed to the server (ticket 02). This is what makes it
   appear on the other device.

The setting should control **(2), never (1)**. Step 1 stays continuous and debounced always, in both
settings, and is invisible. In manual mode the Note simply does not enter the Outbox until the user
presses the button. Concretely, that is one deferral: **`pendingRev` is minted at button-press
instead of at edit-time.** 02's three equality tests, its conflict branch, both of its `baseRev`
traps and 03's "Outbox is a column" all survive untouched.

**The one trap this introduces, which must not be missed.** *(Real, but dissolved — it exists only
under this section's candidate plan of deferring the `pendingRev` mint to button-press. The shipping
design mints at edit-time unconditionally, so the guard below never widens. Kept because the
reasoning is why the shipping design has the shape it has.)* 02's rule is that an incoming
`onSnapshot` must never overwrite a *dirty* Note's local body, and 03 defines dirty as
`pendingRev !== null`. A manually-unsaved Note has `pendingRev === null` and would therefore be
**silently overwritten by the other device's snapshot** — the user's unsent paragraph vanishing while
they look at it. So the snapshot guard's predicate must widen from `pendingRev !== null` to
`pendingRev !== null || <local content differs from last-pushed>`. This is a real, load-bearing
change to 02's invariant and is the strongest reason not to let anyone implement manual save by
intuition. It should be re-checked with the Mathematician, not just written down.

**Where it lands in the Designer's architecture.** [`architecture.md`](../architecture.md)'s write
path is *"Editor textarea → debounce 600 ms, or a lifecycle flush → `saveNote()`: resolve title, mint
`pendingRev`, `store.put(row)` **first**, then push."* Manual save splits exactly that sentence at
one seam: `store.put(row)` stays on the debounce, `mint pendingRev` moves to the button. Nothing
else in the module map moves, and the widened snapshot guard lands in `sync/applySnapshot.ts`, which
architecture.md already names as the home of 02's two model-checked traps — so the re-check has an
owner and a file.

**Recommendation:** build the setting as described — it controls when your words *leave this device*,
not whether they are kept — and label it in those terms rather than as "save", because "save" implies
the other setting can lose text, which is never true.

**Answered.** See "Sync Now and Auto sync" above: the reading was accepted, the seam moved from the
`pendingRev` mint to the `begin-push` trigger on the Mathematician's correction, and the names are
Badrish's. The `blur` / `visibilitychange` / `pagehide` question is answered there too — they flush
to the mirror in both settings and send in neither.

### Deliberately not decided here

- List **ordering** and **pinning** — map fog. The prototype provisionally sorts `updatedAt desc`
  because it needs *some* order; that is not a decision.
- **Search matching, ranking, scope** — ticket 06.
- **The Conflict-copy badge and the merge surface** — ticket 11.
- **Android back-button behaviour** — map fog, but now sharp enough to graduate. See below.
- First-run **onboarding**, and the **Trash purge trigger** — untouched fog.

### One patch of fog is now sharp enough to ticket

**Android back-button and history behaviour.** This ticket's navigation makes it concrete rather than
speculative: the phone shell has a real list→editor push, Trash is a mode the user can be inside, and
the conflict redirect deliberately uses `replaceState` while ordinary navigation would use
`pushState`. Those three now interact, and "what does the hardware Back button do" has a specific
answer that must be decided in one place rather than emerging from whatever the router does by
default. Recommend graduating it to its own ticket, blocked by nothing.
