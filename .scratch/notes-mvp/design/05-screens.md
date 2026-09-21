# Screens — ticket 05, build step 6

Author: ui-ux. Ships Variant A (master-detail) only. Source of truth for every visual state,
string and accessible name Frontend implements against. Ticket 05 is settled; this file does not
re-argue it, only makes it buildable. Real types: `src/domain/note.ts` (`LocalNote`, `NoteId`,
`Rev`), `src/domain/title.ts` (`isDefaultTitle`, `resolveTitle`, `nextUntitledN`). Component names
are architecture.md's: `AppShell, NoteList, SearchField, Editor, TitleField, TrashView, SyncStrip,
EmptyStates, SignIn`.

Step 6 touches no network. Everything below renders from a seeded `LocalNote[]` in
`memoryNoteStore` plus `meta.initialSyncCompletedAt`. No offline badge, no `navigator.onLine`,
anywhere — all sync affordance is `pendingRev !== null` on a Note, never a network claim.

A note on `LocalNote.title`: `resolveTitle` runs at **save** time, so a clean row's `title` field
already holds the resolved string — Derived, Custom or Default. No component re-derives it from
`body`; the placeholder text a Derived/Default row shows in `TitleField` is simply `note.title`.
`isDefaultTitle(note)` is the only sanctioned way to ask "is this a Default title" — never a
regex on the stored string.

---

## My two placement decisions

**`Sync Now` sits in the list header**, as an icon button next to the overflow menu, on both the
desktop list pane and the phone list screen. Reasoning: `Sync Now` drains the *whole* Outbox, not
the open Note — it is a global action. The list header is the one chrome present on every screen
at all times (desktop: persistent pane; phone: the home screen). The editor toolbar disappears
the instant no Note is open, and putting a global action inside a per-Note surface would misread
as "sync this Note," which is not what it does. It is not duplicated in the editor toolbar.

**`Auto sync` lives in the list header's overflow menu**, as a toggle row, alongside `Trash` and
`Sign out` — the only place in this app that already behaves like a settings menu. There is no
dedicated settings screen and building one for a single boolean would be scope the product does
not need; the overflow menu is already the junk drawer for account-level actions, and a toggle
fits it exactly.

---

## 1. AppShell

Props: none from outside (root component). Reads `useCorpus()`, `useOutboxCount()`,
`meta.initialSyncCompletedAt` via a hook, and owns `openNoteId: NoteId | null`, `view: 'notes' |
'trash'`, `autoSync: boolean` (default `true`), `banner: ConflictBanner | null`.

**Breakpoint is a CSS media query, not JS state.** `>760px` uses CSS Grid /
`display: flex` with a fixed `340px` list column expressed in a stylesheet
(`@media (min-width: 761px)`), not a `window.innerWidth` listener. Rationale: a resize crossing
the breakpoint must not lose React state (`openNoteId`, scroll position, draft text) the way a
conditional-render-based JS breakpoint would if it unmounts/remounts the tree; a pure CSS layout
change never unmounts anything under it.

Desktop (`>760px`) layout: two fixed panes, `<div class="shell shell--wide">` — left `NoteList`
(340px), right `Editor` or the "pick a note" empty pane. Both always mounted; CSS shows/hides
nothing since both live side by side.

Phone (`≤760px`) layout: exactly one of `NoteList` (view=list) or `Editor` (view=note) is
mounted at a time — this one *is* a real conditional render, because only one screen exists at
once and there is nothing to preserve on the other side. Switching is a push (`history.pushState`)
except the conflict redirect, which never pushes (see §9).

`AppShell` renders, in this order, top to bottom regardless of breakpoint: the active screen(s),
then `SyncStrip` pinned to the bottom of the whole shell (spans full width even in two-pane mode —
it is one strip for the app, not one per pane).

Does not: decide search matching, decide list ordering algorithm (fixed: `updatedAt desc`,
handed down from architecture.md), render the conflict `Compare` surface (ticket 11).

### StorageError — Builder's call #2, step 7

Renders full-screen, **in place of the entire shell** (not a strip, not layered over `NoteList` —
there is no list to show, since the per-uid IndexedDB database that failed to open is the only
source of one). Reached when opening the app's IndexedDB database rejects or the browser has no
IndexedDB at all (private-browsing lockouts in some browsers, corruption, a blocked storage
permission). At step 7 this happens **after sign-in succeeds** — the database is per-uid, so it
can only be opened once the uid is known — so the sequence is `SignIn` → (success) → attempt to
open storage → this state on failure, in place of where the shell would otherwise mount.

> Can't open this device's note storage. Nothing has been changed — try reloading.

Confirmed as-is. It's accurate (nothing has been attempted yet, so nothing is lost), it's
terminal (matches this app's rule that failure states don't spin forever), and "try reloading" is
the one action that's actually likely to help (a transient lock or a one-off browser hiccup often
clears on reload; this app has no in-app retry button anywhere else either, per §6's sign-in
failure using the same terminal-with-manual-retry shape).

One primary button, `<button>Reload</button>`, calling `window.location.reload()` — the only
control on the screen besides the message. No sign-out option here: the failure is about *this
device's storage*, not the account, and offering sign-out would incorrectly suggest switching
accounts fixes a device-local problem.

Props: none beyond the trigger condition itself — this is a terminal screen with one action, not
a component that takes configuration.

---

## 2. NoteList (+ its row)

Props: `notes: LocalNote[]` (already filtered/sorted by the caller's `view` + `query`),
`view: 'notes' | 'trash'`, `activeId: NoteId | null`, `query: string`, `onQueryChange: (s: string)
=> void`, `onSelect: (id: NoteId) => void`, `onNewNote: () => void`, `autoSync: boolean`,
`onToggleAutoSync: () => void`, `onSyncNow: () => void`, `pendingCount: number`,
`initialSyncCompletedAt: number | null`.

**Header** (always rendered, both form factors): `SearchField` (see §3) filling the remaining
width, then three icon buttons in this order: `Sync Now`, overflow menu (`⋮`), and — desktop
only — a `New note` text button (phone uses the FAB instead, no header button).

- `Sync Now` — `<button aria-label="Sync now">`. No visible label text on either form factor to
  keep the header from crowding on phone; the accessible name carries it. Always enabled,
  regardless of `autoSync` or outbox emptiness (pressing it with an empty Outbox is a harmless
  no-op). Icon only in this spec; exact glyph is Frontend's call (a refresh/circular-arrow glyph
  is conventional).
- Overflow menu — `<button aria-label="Menu" aria-haspopup="menu" aria-expanded="{open}">⋮</button>`
  opening `role="menu"` with items, each `role="menuitemcheckbox"` where a toggle:
  - In `notes` view: `menuitem` **"Trash"** → switches to `view: 'trash'`, clears `query`, clears
    `openId` (phone) / leaves editor pane on "pick a note" (desktop).
  - In `trash` view: `menuitem` **"Back to notes"** → the reverse.
  - `menuitemcheckbox` **"Auto sync"**, `aria-checked="{autoSync}"` → toggles `autoSync`. No
    sub-copy in the menu itself; if a one-line explanation is wanted it is *"Off: notes only sync
    when you tap Sync Now."*, shown as a disabled/greyed helper row directly under the checkbox
    item, visible always (not just when off).
  - `menuitem` **"{userEmail} · Sign out"** — literal user email interpolated, then sign-out
    action. (Sign-out itself is out of scope for step 6's seeded store; render the item, wire the
    handler as a stub Frontend can no-op.)
- `New note` (desktop only) — `<button>New note</button>`, calls `onNewNote`.

**Row** — `<button class="row" aria-current="{id === activeId ? 'true' : undefined}">` (a button,
not a link — no `<a>`, this is an in-app state change, not navigation to a URL the row itself
owns). Accessible name is the row's *visible title text* (the same string rendered — do not
give it a separate `aria-label`; a screen reader should hear exactly what's on screen).

Contents, top to bottom:
1. Title line: `resolveTitle` output as already stored in `note.title`. When
   `isDefaultTitle(note)` is true, rendered muted + italic (this is the **only** styling
   difference — no additional icon or text marks a Default title, per ticket 05: "a Default
   title is never announced"). Truncated with ellipsis, one line.
2. Reserved badge slot immediately after the title, same line, empty in step 6:
   `<span class="badge-slot" data-testid="conflict-badge-slot" />` — ticket 11 lands its content
   here later; render nothing visible now, but keep the element in the DOM so 11 doesn't need a
   relayout.
3. Timestamp / meta line: in `notes` view, relative time from `note.updatedAt` (e.g. `4m ago`,
   `3h ago`, `2d ago` — exact formatting function is Frontend's, ticket 05 doesn't specify
   granularity beyond the prototype's). In `trash` view, `deleted {relative time from
   note.deletedAt}` (e.g. `deleted 2d ago`).
4. Amber Outbox dot: rendered when `note.pendingRev !== null`, a small filled circle *before* the
   meta text on the same line. `aria-hidden="true"` with no separate accessible text — the dot is
   a supplementary visual cue, not new information a screen-reader user is missing (nothing in
   this app is sync-blocking or requires action from the Outbox state).

**Ordering**: `updatedAt desc` in `notes` view, `deletedAt desc` in `trash` view. `NoteList` does
not sort — it renders whatever order it's given; the caller (a `projection.ts`-backed hook) sorts.

**Does not**: compute search matches/ranking (ticket 06 — `NoteList` only renders the list it's
handed and shows the no-results empty state when it's told there are none for a non-empty query),
decide the conflict badge's appearance (ticket 11), decide `Sync Now`'s network behavior (that's
`sync/engine.ts`; the button here is a dumb call to a passed-in handler).

---

## 3. SearchField

Props: `value: string`, `onChange: (s: string) => void`, `placeholder: string` (caller passes
`"Search notes"` in `notes` view, `"Search trash"` in `trash` view — one component, caller decides
the string).

Always visible, top of the list header, never an icon that expands. `<input type="search"
aria-label="Search notes">` (accessible name matches the visible placeholder's subject — literally
"Search notes" / "Search trash", not "Search" alone, since a screen-reader user tabbing in from
elsewhere in the app should know which corpus they're about to filter). Filters in place as the
user types — no submit button, no Enter-to-search. Clearing the field (native `type=search`'s ×,
or manually deleting all text) shows the un-filtered `view`'s full list again.

Does not: implement matching, ranking, debounce policy, or scope (title vs. body) — ticket 06.
This spec only fixes that the field exists, here, always, and fires on every keystroke.

---

## 4. Editor

Props: `note: LocalNote`, `onTitleInput: (value: string) => void`, `onBodyInput: (value: string)
=> void`, `onDelete: () => void`, `onRestore: () => void`, `onBack?: () => void` (phone only),
`banner: ConflictBanner | null`, `onDismissBanner: () => void`.

**Toolbar** (top): phone-only back arrow (`<button aria-label="Back to notes">←</button>`,
`onBack`) on the left when present; a `Preview` toggle button; a spacer; the status text; a
delete button (hidden when the Note is already in Trash — see read-only below).

- `Preview` — `<button aria-pressed="{previewOpen}">Preview</button>`. **This is an invoked
  action, not a mode and not persisted**: pressing it swaps the body `<textarea>` for a read-only
  rendered view of the same markdown; pressing it again (the same button, its label does not
  change — no "Back to editing" relabel needed since `aria-pressed` communicates state) returns to
  the textarea. `previewOpen` is local component state, reset to `false` on every Note switch —
  it is never carried in `LocalNote` or the corpus. No split-pane on any form factor.
- Status text, `<span class="status">`: `"Saved"` when `note.pendingRev === null`, `"Saved on
  this device"` when `note.pendingRev !== null`. Plain text, not a button, no tooltip. Never a
  spinner, toast or error dialog — ticket 05 is explicit these don't exist anywhere in this app.
- Delete — `<button aria-label="Move to Trash">🗑</button>` (or equivalent icon), calls
  `onDelete`. Absent (not present, not merely disabled) when the open Note is already in Trash,
  because Restore already covers reversal there.

**Read-only (Trash) state** — when `note.deletedAt !== null`: `TitleField` and the body are both
disabled (no `contentEditable`, `<input disabled>` / `<textarea disabled>`), `Preview` still
works (reading a trashed Note's rendered markdown is harmless), delete button is absent. A banner
renders directly under the toolbar, always-on (not dismissible — this one is a standing fact
about the document, not a one-time notice):

> This note is in the Trash and can't be edited. It's purged 30 days after deletion.

with one action, `<button>Restore</button>`, calling `onRestore`. On restore, the Note becomes
editable in place (no navigation) and this banner disappears.

**Conflict-redirect banner** — see §9, rendered here, above `TitleField`, below the Trash banner
if somehow both apply (they cannot in practice: a Note that is itself a Conflict copy is never
also in Trash in this seeded scenario set).

**Body-too-large-to-sync strip** — a persistent strip at the *bottom* of the editor pane (above
`SyncStrip`, which is shell-global, not editor-local), shown whenever
`exceedsSyncLimit(note)` (`src/domain/size.ts`, real UTF-8 byte count against
`SYNC_SIZE_LIMIT_BYTES`) is true. Do not approximate with UTF-16 code units or string length —
that under-counts every emoji and CJK character 2-3x, which is exactly the silent-stuck-Outbox
failure this threshold exists to make visible instead of hiding.

> This note is too large to sync. Shorten it to sync.

No dismiss, no icon needed beyond the text; it disappears the instant the Note is back under the
threshold. It does **not** block typing — the textarea never refuses a keystroke.

**Markdown body**: `<textarea class="body" aria-label="Note body">`, monospace font, one field,
no WYSIWYG, no contenteditable. Placeholder `"Start writing…"` shown only on a body with zero
characters (i.e. every brand-new Note, before the first keystroke).

**New Note focus**: on creation, focus goes to the body textarea, never the title field — per
ticket 05, to avoid nudging every new Note across the title latch on creation.

**Saving**: continuous, debounced ~600ms, one write per keystroke-burst covering title+body
together; also flushed on unmount, `blur`, `visibilitychange → hidden`, `pagehide`. This spec
does not restate the debounce/flush mechanism (architecture.md's `platform/lifecycle.ts` owns
it) — `Editor` just calls `onTitleInput`/`onBodyInput` on every native input event and trusts the
caller to debounce.

**Re-seeding the open Note on a remote edit — Builder's call #1, step 7.** The Mathematician's
2026-09-21 amendment to ticket 02 makes re-seeding *safe* exactly when the editor's buffer equals
its base content and no save is queued or in flight (his rule 5) — this is the idle-open-Note
case: nobody has typed since the Note was opened, or everything typed has already been committed
and confirmed clean. `Editor` is told this via a prop, `canReseed: boolean`, computed by the
caller from the save queue; `Editor` does not compute it.

**Ruling: re-seed silently, no banner, no notice.** This app already has a standing rule that a
remote edit to a *closed* Note updates its list row with no announcement — a re-seed is the same
event, just visible because the Note happens to be open. Ticket 05 is explicit that this app has
no toast, no spinner, no error dialog anywhere; inventing one occurrence for this case would be
the one inconsistency in an otherwise disciplined UI. It is also the honest read of what
"idle" means here: `canReseed` is only true when the user has typed nothing unconfirmed, so
nothing of theirs is at risk — the app is simply keeping a document current, the same thing every
synced-notes app does to a note you're merely looking at, not editing.

This is a different event from the conflict-redirect silent swap in §9 (there the content the
user is looking at is *unchanged*, only the id underneath it moves). Here the visible text
genuinely changes, so it needs its own rule for caret/scroll/selection, not a borrowed one:

- **Implementation model: treat it exactly like a fresh open.** Remount `Editor` (new React
  `key`, e.g. keyed on `note.rev` in addition to `note.id`) rather than mutating the mounted
  textarea's value in place — this reuses the same "seed once per mount" contract the component
  already has, instead of adding a second code path for "update a live textarea's content out
  from under the user."
- **Caret and selection**: reset to the start of the body (position 0), same as any other fresh
  open. Any active text selection is discarded — the old selection's character offsets refer to
  text that no longer exists at those offsets, so there is nothing meaningful to preserve. This
  applies uniformly whether the user is focused-but-idle, has a selection, or is not looking at
  the editor at all.
- **Scroll position**: resets to the top of the body, matching a fresh open. Do not attempt to
  preserve scroll offset — the content it was anchored to may have moved or been rewritten.
- **Focus**: never stolen. If the user's focus was already inside `TitleField` or the body
  textarea, focus stays where it structurally is (the remounted field of the same kind) — the
  caret resets per the point above, but the field itself doesn't lose focus to, say, the list. If
  focus was elsewhere (the list, the overflow menu, another pane), it stays there; re-seeding
  never moves focus into the editor.
- **`Preview` toggle**: `previewOpen` is already local state reset on every Note switch (§4
  above); a re-seed is not a Note switch (same `id`, same open Note) but should reset it anyway,
  for the same reason a remount does — the previewed markdown is now the old text.
- **When `canReseed` is false** (something typed since open, even if since committed and clean —
  i.e. a save is queued or in flight): do not re-seed. Per the Mathematician's rule, the next
  keystroke correctly produces a Conflict copy instead, which is the safety property this whole
  mechanism protects. `Editor` shows nothing different while this pends — no "this note has
  unsynced remote changes" notice, because that would be describing internal state the user has
  no action to take on, and the app doesn't warn about states it can't act on.

**`Preview`'s markdown subset — Builder's scope, stated here so it's a decision, not whatever
Frontend gets round to.** There is no markdown dependency in this project and none is being
added. `Preview` renders a small hand-rolled subset to React elements — **never**
`dangerouslySetInnerHTML`, so raw HTML pasted into a note is inert by construction: ATX headings,
bullet and ordered lists, fenced and inline code, bold, italic, links restricted to `http`/`https`
schemes only. Everything outside that subset renders as its literal source text, unstyled.

Does not: implement `Sync Now` (lives in `NoteList`'s header, see decisions above), implement the
save pipeline.

---

## 5. TitleField

Props: `titleIsCustom: boolean`, `title: string` (the raw stored/live value — see below),
`resolvedPlaceholder: string` (equal to `note.title` when `!titleIsCustom`; see the note above on
`resolveTitle`), `untitledPreviewN: number` (see "Custom but emptied" below), `onChange: (value:
string) => void`, `disabled: boolean` (true in Trash's read-only state).

`<input class="title" aria-label="Title">`. Exactly three visual states, driven purely by
`titleIsCustom` and the live input value — never by re-deriving anything from `body`:

**1. Derived (or Default) — `titleIsCustom === false`.**
Input `value=""`, `placeholder={resolvedPlaceholder}`. Placeholder rendered **muted and italic**
(this is the field showing exactly what the list row shows for a Default title, and exactly the
resolved derived string for a Derived title — no visual distinction between the two sub-cases in
the field itself). Below the input, one line, always shown in this state:

> Following the first line of the note. Type here to name it yourself.

**2. Custom, non-empty — `titleIsCustom === true` and the live value is non-empty.**
Input has a real `value`, rendered **solid black** (normal input text color, not muted). No hint
line below it. The moment the user's first keystroke lands in this field while state 1 was
showing, this is the transition that fires — **the one-way latch**. `onChange` fires
`{ titleIsCustom: true, title: <new value> }` on that very first keystroke, and every keystroke
after. There is no UI element anywhere that reverses this — no "follow the first line again"
action, no undo, no confirmation dialog before the latch fires. It fires silently on keystroke
one.

**3. Custom, emptied — `titleIsCustom === true` and the live value is empty.**
This is what the user sees the instant they delete every character out of a Custom title (before
it saves). Input `value=""` (solid, not the muted placeholder styling — it is empty text the
user just produced, not a placeholder). Below it, this exact line, with the live-computed number
substituted:

> This note keeps its own title now — clearing it doesn't go back to following the first line.
> It's listed as *Untitled Note {untitledPreviewN}*.

`untitledPreviewN` is the number this Note will actually be assigned on save — computed the same
way `resolveTitle`'s branch 3 would (`nextUntitledN` over the mirror's current titles). Compute
it live in the caller so the hint never lies about which number lands; do not hardcode or guess.
`Untitled Note {N}` itself renders in italics inline (matching how the resolved title reads
elsewhere, e.g. the list row).

**Hard constraint, restated because it is the one Frontend is most likely to "helpfully" soften:
the latch has no escape hatch anywhere in this component or any other.** Do not add a button,
long-press, or settings toggle that restores derivation. If this needs revisiting, it goes back
to Badrish, not into an implementation detail.

Does not: decide the 100-character truncation display (that's `resolveTitle`'s job — the field
just renders whatever string it's given, uncut, since 100 chars fits an input comfortably).

---

## 6. First-load states, no-search-results, sign-in-no-network — EmptyStates

All rendered by `EmptyStates` in place of `NoteList`'s row area (header + `SearchField` still
render above them **except** the two cold-start states, which have nothing to search yet and
should still show the header chrome so the shell doesn't look broken — search simply filters an
empty/loading list harmlessly). Selection is a pure function of `initialSyncCompletedAt` (store
meta) + corpus emptiness + `query` — a UI fact only, decided by the caller, not by `EmptyStates`
itself sniffing the network.

Props: `kind: 'downloading' | 'downloading-offline' | 'empty' | 'no-results' | 'signin-offline'`,
`query?: string` (for `no-results`), `onWriteFirstNote?: () => void` (for `empty`),
`onRetry?: () => void` (for `signin-offline`).

**1. New device, downloading** (`initialSyncCompletedAt === null`, corpus not yet known empty —
render this the moment the app opens on a device that's never completed an initial sync,
regardless of whether the mirror happens to be empty):

> Getting your notes…
> This device is downloading your notes for the first time.

Below the text, a skeleton block (a handful of grey placeholder bars) standing in for rows about
to arrive. No spinner-as-the-only-signal — the copy is the primary communication, the skeleton is
decoration.

**2. New device, no network** (`initialSyncCompletedAt === null` and the app has determined it
cannot reach the server — for step 6's seeded/no-network build this is a scenario the harness
forces, not something `EmptyStates` detects itself):

> Waiting for a connection.
> This device hasn't downloaded your notes yet.

No skeleton (nothing is in flight to preview), no retry button — this resolves itself once a
`SnapshotBatch` arrives, invisibly.

**3. Genuinely empty account** (`initialSyncCompletedAt !== null`, corpus has zero live Notes,
`query` empty):

> No notes yet.
> Everything you write is saved on this device first, then synced.

Plus one primary button: `<button class="primary">Write your first note</button>`, calling
`onWriteFirstNote` (same action as the header's `New note` / phone's FAB).

**4. No search results** (`query` non-empty, filtered list empty, applies in both `notes` and
`trash` views):

> No notes match "{query}"
> Search looks at titles and note text.

The query is interpolated verbatim, quoted. No action button — clearing the search field is the
only next step and the field is right above it.

**5. Sign-in, no network** (`signInWithPopup` failed):

> Can't reach Google to sign in. Check your connection and try again — nothing is lost.

Rendered under the `Continue with Google` button on the `SignIn` screen (see below), not inside
`NoteList` — this state precedes having a corpus at all. No infinite spinner ever; failure is
always terminal until the user retries.

**A returning device with a populated mirror never passes through `EmptyStates` at all** — the
list renders immediately from the already-usable mirror; there is no loading flash to design.

---

## 7. SyncStrip

Props: `pendingCount: number`, `autoSync: boolean`, `persistDenied: boolean`, `onSyncNow: () =>
void`.

Renders nothing (`null`) when `pendingCount === 0`, regardless of the other two flags — an empty
Outbox has nothing to report. Otherwise, the two flags are **independent**, not a priority order
— `persistDenied` and `autoSync` each control one clause of the sentence on their own, so there
are **four** states in total. Enumerated explicitly so no cell is left for Frontend to infer:

**Ruling — Builder, 2026-09-18, overriding my original priority-order draft.** The reassurance
clause (`they're safe on this device`) drops when `persistDenied`, exactly as ticket 05 says —
it's a promise that can't be made honestly while eviction is possible. The action clause
(`· Sync now`) appears whenever `autoSync === false`, independent of `persistDenied`, because
`Sync now` is an action, not a reassurance, so 05's "the reassurance clause drops entirely"
doesn't reach it — and a user with persist denied is exactly the user who most needs their words
off this device before eviction, so a strip that states the problem and offers nothing is worse
than one that offers the one thing that actually reduces the exposure (a synced Note survives
eviction).

**1. `autoSync === true`, `persistDenied === false`:**

> {N} note{s} waiting to sync · they're safe on this device

Plain text, not interactive. No retry button ever — retry is automatic backoff, and this
sentence stays honestly true whether the cause is no network, a dead server, or a rejected write.

**2. `autoSync === true`, `persistDenied === true`:**

> {N} note{s} waiting to sync.

Bare, no second clause, not interactive. The reassurance would be dishonest under eviction risk.

**3. `autoSync === false`, `persistDenied === false`:**

> {N} note{s} waiting to sync · Sync now

The entire strip is one `<button>` in this state (`aria-label` = the full sentence, since
"Sync now" is the tap target per ticket 05 and the whole strip reads as the affordance), calling
`onSyncNow`. This is the identical action as the list header's `Sync Now` button — two entry
points to the same call, not two different behaviors.

**4. `autoSync === false`, `persistDenied === true`:**

> {N} note{s} waiting to sync · Sync now

Same interactive strip as state 3 — the action clause appears regardless of `persistDenied`, and
no reassurance clause exists here to drop.

Pluralization: `"1 note waiting to sync"` / `"{N} notes waiting to sync"` — singular only at
exactly 1.

Does not: decide backoff timing or trigger policy (`sync/engine.ts`), decide when
`persist()` is (re-)requested (`platform/persistStorage.ts`).

---

## 8. TrashView

This is `NoteList` rendered with `view="trash"` plus `Editor` rendered read-only — there is no
separate component tree, per architecture.md ("`TrashView` … reuses the list screen in a Trash
mode"). What differs, spelled out so Frontend doesn't have to infer it from `NoteList`'s spec:

- Reached via the list header's overflow menu item **"Trash"** (see §2). Desktop: the left pane
  swaps its list contents and header label context switches (`SearchField` placeholder becomes
  `"Search trash"`); the right pane keeps whatever was open unless that Note itself just got
  filtered out of view (opening a live Note, then navigating to Trash, doesn't close the editor —
  the editor stays on the live Note; Trash is a *list* mode swap, not a forced navigation away
  from the editor).
- Row meta line: `deleted {relative time}` in place of the updated-time (§2, point 3).
- Empty state (§6 is silent on this one — it's Trash-specific and belongs here): when Trash has
  zero Notes:

  > Trash is empty.
  > Deleted notes wait here for 30 days before they're purged.

- Opening a trashed row opens `Editor` in its read-only state (§4) — banner, disabled fields,
  `Restore` action, no delete button.
- Exiting Trash: overflow menu item flips to **"Back to notes"** while `view === 'trash'` (§2).

Does not: implement the 30-day purge trigger (map fog, ticket 05 explicitly leaves it
undecided) or decide what happens to `openId` if the open trashed Note gets purged mid-session
(out of scope for a step-6 seeded, no-network build where nothing purges).

---

## 9. The conflict-redirect banner

Props (on `Editor`): `banner: { text: string; action: 'Compare' } | null`, `onDismiss: () =>
void`.

Renders as a non-blocking, dismissible bar above `TitleField`:

> This note was edited on another device too. You're still in your version — the other one is
> kept separately.

with two controls: `<button>Compare</button>` and `<button aria-label="Dismiss">✕</button>`
(`onDismiss`).

**At step 6, `Compare` is present but inert** — render the button (so its layout slot exists and
Frontend doesn't have to retrofit space for it later), wire its `onClick` to a no-op or a
console-only stub. It does nothing yet because the comparison/merge surface it opens is ticket
11's, not built at this step. Do not disable or hide the button — an inert-but-visible button
here documents that the feature is coming, and ticket 11 replaces the stub wholesale without
touching this banner's markup.

**Hard requirement on Frontend, stated as a constraint the implementation must satisfy, not a
suggestion:** when the redirect happens (the document identity swaps from `noteId` to the Conflict
copy's id under the user), **not one visible character in the editor changes and the text
selection is preserved exactly**. Concretely: the `<textarea>`'s `value`, scroll position, and
`selectionStart`/`selectionEnd` must be numerically identical immediately before and after the
swap; only the underlying `note` object's `id` (and therefore what future edits are keyed to)
changes. The URL updates via `history.replaceState`, **never** `history.pushState` — a `pushState`
here means the browser Back button returns to an id that now holds the *other* device's text,
reintroducing the same bug through Back instead of through the redirect. The list must not
re-sort or scroll the open Note out of view during the swap (the copy's `updatedAt` may be newer
and would naturally sort first — that's fine, expected, and not this constraint; the constraint is
about the *editor pane*, not list ordering).

Dismissing the banner (✕) is permanent for that redirect instance — it does not reappear on
re-render of the same Note unless a *new* redirect occurs. `banner` state therefore lives in
`AppShell`, keyed to a redirect event, not derived from `note.conflictOf` on every render (a
dismissed banner must stay dismissed even though `conflictOf` remains true forever).

---

## SignIn

Not in the "cover at minimum" list but referenced by state 6 above and needed for it to be
buildable. Minimal: app name/tagline, one primary button `<button>Continue with Google</button>`,
and — only in the failure case — the sign-in-no-network copy from §6 rendered beneath it. No
spinner state beyond native button press feedback; `signInWithPopup`'s own promise resolves or
rejects, there is nothing in between to render.

### Sign-in outcomes other than "no network" — Builder's call #3, step 7

`signInWithPopup` has more outcomes than success and network failure. Ruling on each:

- **User closes the popup themselves** (`auth/popup-closed-by-user`, and its sibling
  `auth/cancelled-popup-request` when a second click races a still-open popup). **Agreed with
  Builder's proposal: nothing.** The button returns to its normal state, no message. This is the
  user changing their mind mid-flow, not a failure — the app has no more standing to comment on
  it than a browser has standing to comment on a closed native dialog. Rendering an error here
  would be the app scolding the user for a click they made on purpose.
- **Browser blocks the popup** (`auth/popup-blocked` — most commonly Safari's stricter popup
  heuristics, or a user-installed popup blocker). This is not a "try again" situation the way
  no-network is, because retrying with the same button produces the same block — the user needs
  to act on the browser first. Distinct copy, same placement (beneath the button, same slot the
  no-network copy uses — the two are mutually exclusive, never both shown):

  > Your browser blocked the sign-in popup. Allow popups for this site, then try again.

  Same `<button>Continue with Google</button>` remains the retry affordance — no separate button —
  since "try again" after allowing popups is genuinely the same action.
- **Any other rejection** (an unexpected Firebase error not covered above — e.g. a config or
  project-side failure). Falls back to the no-network copy's wording pattern rather than a bare
  stack trace or a blank failure: reuse the existing no-network slot with a generic line rather
  than inventing a third string for a case nobody can name in advance:

  > Something went wrong signing in. Check your connection and try again — nothing is lost.

  This is a deliberate widening of §6's existing copy (dropping "Can't reach Google" as the
  specific cause) used only for the residual "none of the above" bucket, not a new visible state —
  it occupies the exact same slot as the no-network message and is never shown alongside it.

- **The instant between "auth unknown" and rendering `SignIn` or the shell.** Firebase reads the
  persisted session from IndexedDB before it knows whether a user is signed in — typically
  under 100ms, and it happens offline too since it's reading local storage, not calling the
  network. **Agreed with Builder's proposal: render nothing** (a blank page, or whatever the
  static HTML shell/root element already looks like before React mounts its first meaningful
  screen) rather than a splash screen. A splash screen for a sub-100ms gap is worse than a blank
  frame: it either flashes too briefly to read as anything but a glitch, or — if given a minimum
  display time to avoid that — it adds latency to every single app open to make an interval nobody
  perceives feel intentional. Nothing to build here beyond: don't render `SignIn` or the shell
  until Firebase's auth-state listener has fired once.

---

## Out of scope, noted so nobody re-derives it

- PWA icons: real icon art is ui-ux's at step 6 per the ticket, but it costs real time to do
  properly and nothing above depends on it rendering — deferring the actual asset work without
  blocking this spec. Placeholder icons stay in place until then.
- Search matching/ranking/scope: ticket 06.
- Conflict-copy badge content and the `Compare`/merge surface: ticket 11.
- Android back-button semantics across list→editor→Trash: flagged as its own ticket in 05,
  unticketed as of this writing.
