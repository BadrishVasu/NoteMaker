# Frontend notebook

## 2026-09-18 — build step 6, the `src/app/` slice (written 2026-09-21, after a rate-limit cutoff)

Built the whole `app/` layer against `05-screens.md`: `AppShell`, `NoteList` (+ row),
`SearchField`, `TitleField`, `Editor`, `SyncStrip`, `EmptyStates`, `SignIn`, `markdown.tsx`
(`Preview`), `saveNote.ts`, `devSeed.ts`, the three `useSyncExternalStore` hooks, and
`platform/lifecycle.ts` + `platform/prefs.ts`. TDD throughout. Two runs got cut off by an API
rate limit before I reached this entry — Builder tells me the tree landed at 852 tests green
plus lint/typecheck/build, and reviewed in four fixes I didn't get to see land. Writing this
from where I actually left off, plus what Builder told me happened after.

**The one I'm glad I got right: the redirect hard constraint.** §9 demands the textarea's
`value`/`selectionStart`/`selectionEnd`/`scrollTop` survive a document-identity swap
byte-for-byte. The fix isn't defensive code, it's an absence of code: keep the `<textarea>`
uncontrolled (`defaultValue`, never `value`), and have `AppShell` key `Editor` on a
`switchToken` that advances on real navigation but *not* on a redirect. No key change means no
remount, means React never touches that DOM node, means the browser just keeps whatever was
already there. I wrote the test for this early (set selection, force a re-render with a
different `note.id` but the same key, assert nothing moved) and it passed first try — a rare
case where the right design makes the hard requirement free instead of something to guard.

**Dead end: chasing an externally-edited file instead of finishing my own design first.**
Mid-build, several files I'd just written (`SyncStrip`, `TitleField`, `hooks.ts`, `AppShell`)
kept changing under me between tool calls — apparently a parallel process converging toward
its own version of the same interfaces. I spent real turns re-reading diffs and reconciling
prop names (`onToggleView` vs `onToggleTrash`, `ConflictBanner` living in `types.ts` vs
`Editor.tsx`) instead of just finishing my own coherent design and letting the pieces settle
once. Next time: pick an owner for the integration surface (usually whoever owns `AppShell`)
and treat everyone else's guess at its prop shape as provisional until that owner commits,
rather than adapting piecemeal every time a file moves.

**Dead end I flagged instead of fixing: `saveQueue.schedule` replacing instead of merging.**
I built the debounce queue keyed per-Note but each `schedule()` call replaced the whole pending
patch with whatever the caller passed. `handleTitleInput`/`handleBodyInput` each built a *full*
`EditPatch` from `openNote` — the corpus's last-known-committed row, not the queue's own
in-flight patch. So typing in the title, then the body, inside the same 600ms window: the body
keystroke's patch carried `openNote.title` (still the old value, since the corpus hadn't caught
up yet), silently overwriting the title edit and reverting the latch. I caught this for
Delete/Restore (added `peekPending` and built their patches on top of it) but didn't connect
that the *same* lag hits Title/Body typed back-to-back — I was thinking of it as a
delete-specific hazard, not a property of the queue itself. Builder's fix was structurally
better: move the merge into the queue (`schedule(id, change)` merges onto pending → in-flight →
live row), so no caller can get it wrong by construction. The lesson: when a debounce queue
holds partial state, ask "what if two different callers schedule different *fields* in the same
window" before shipping, not just "what if the same field is scheduled twice."

**Dead end: `initialSyncCompletedAt` written from two places.** `devSeed.ts` and `AppShell`'s
boot effect both set this meta key — the seed because it's convenient for a dev build to look
"synced" immediately, AppShell because step 6 has no engine and I wanted the downloading state
to resolve. I did leave a comment flagging the AppShell write as a step-7 seam, which is the
only reason it got caught cleanly instead of silently conflicting with the real engine later.
Should have asked instead of writing two silent sources of truth for one key — a key that says
"who is allowed to set this" belongs in its own doc line, not inferred from who happens to need
it first.

**Dead end: passive `useEffect` for the new-Note focus.** I used `useEffect` for the
"focus the body on creation" behavior. Passive effects run after paint, so there's a real
(if narrow) frame where the textarea is on screen but nothing has focus yet — enough to make an
AppShell-level focus assertion flaky under load. `useLayoutEffect` closes that gap since it runs
before the browser paints. Rule for next time: any imperative DOM action gating a *test
assertion made immediately after render* (focus, scroll position, selection) wants
`useLayoutEffect`, not `useEffect`, even when the visual difference is imperceptible to a human.

**Not a dead end, but worth restating for whoever's next:** the title latch has no escape hatch
anywhere I wrote, on purpose, per Badrish's explicit call against both UI/UX's and my own
instinct. Don't add one. If it needs revisiting it goes to Badrish, not into `TitleField` or
`Editor` as an implementation detail.

**Also worth knowing:** `handleNewNote` originally had no `.catch` on its async IIFE — QA
caught this after I'd moved on. Any `void (async () => {...})()` fire-and-forget pattern in
`AppShell` needs an explicit `.catch` or a swallowed IndexedDB failure (quota, blocked upgrade)
disappears as an unhandled rejection instead of surfacing anywhere a user or a test can see it.
Check every one of those call sites, not just the one that got flagged.
