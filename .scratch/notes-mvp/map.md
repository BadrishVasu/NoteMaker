# Map: NoteMaker MVP

Label: `wayfinder:map`
Effort: `notes-mvp`
Tickets: `.scratch/notes-mvp/issues/`

## Destination

A deployed web app on a free `*.pages.dev` URL, installable to Badrish's Android homescreen as a
PWA, where a markdown Note written on either device appears on the other — signed in with Google,
working with no network, and used daily.

Reaching the destination means the app is *running and in use*, not specified.

## Notes

**Domain**: a personal offline-first notes PWA. Vocabulary lives in [CONTEXT.md](../../CONTEXT.md);
challenge any session that drifts from it.

**Skills every session consults**: `grilling` and `domain-modeling` by default; `research` for facts
outside this working directory; `prototype` when the question is "how should this look or behave".

**Execution override**: wayfinder is plan-not-do by default. This map overrides that. The
destination is a *shipped, deployed* MVP, so once the decision tickets close, this map carries
execution through to a running app rather than stopping at a spec.

**Standing preferences**: TDD is mandatory — a failing test first, then the minimum code to pass.
Production-ready code, no placeholder logic, no stubs in finished work. Prefer simple and direct
over clever; no premature abstraction. Be token-judicious.

**Agents**: the `designer` agent takes the architecture once tickets 01–03 close; the `builder`
agent leads implementation after that and summons its own build team. The `mathematician` agent is
for ticket 02 specifically, which is hard and expensive to get wrong.

**Locked decisions carried in from charting** (settled with Badrish, do not re-open without him):
single user but real per-user auth and isolation from day one; PWA, no Play Store; markdown Notes
in a flat list; offline-first; last-write-wins with a Conflict copy; Firebase Firestore + Firebase
Auth with Google sign-in; Vite + React SPA with `vite-plugin-pwa`, no SSR; soft delete via
Tombstone with a 30-day Trash purge; client-side search; Cloudflare Pages free tier; no E2E
encryption.

Firestore was Badrish's call, taken with the last-write-wins caveat stated: Firestore's offline
queue replays writes unconditionally on reconnect, which by default discards the losing edit. That
tension is ticket 02, not a settled matter.

**Architecture**: with 01–05 closed, the application architecture lives at
[architecture.md](architecture.md) — module boundaries, the ports that make ticket 02's mechanism
testable without Firebase, and the build order. Proposed by `designer`, open for the `builder`'s
response in the file itself.

## Decisions so far

<!-- one line per closed ticket: gist of the answer, then the link to the detail -->

- [01 · Firestore data model and security rules](../issues/01-firestore-data-model.md): Notes live
  at `users/{uid}/notes/{noteId}` with client-generated auto-IDs; **timestamps are client-side epoch
  millis, not `serverTimestamp()`**, because a server timestamp reads back null from the local cache
  and would leave offline writes with no sort key and nothing for LWW to compare — the accepted cost
  is clock skew, which ticket 02 must bound. Title is always persisted and never empty: Derived from
  the body's first line until the user types in the title field, which latches it Custom one-way,
  with a `Untitled Note N` Default title as the fallback that makes a strict non-empty rule safe.
  Rules validate ownership **and** document shape, tested against the emulator with
  `@firebase/rules-unit-testing`. Composite indexes deferred to ticket 03 — a fully mirrored local
  corpus needs none. A `<version>` field is reserved for ticket 02 to name.
- [02 · Conflict-copy mechanism under Firestore's offline queue](../issues/02-conflict-copy-mechanism.md):
  The SDK's offline queue is **never used for Note writes** — every write goes through
  `runTransaction`, which rejects offline instead of queueing, making unconditional replay
  structurally impossible. Edits live in our own **Outbox** until reconnect, where one transaction
  compares the server's `rev` against the **Fork point**; equal means a clean push, otherwise the
  server's version survives untouched and our content is written as a Conflict copy. `rev` is an
  **opaque token, not a counter** — a counter fabricates conflicts on retry. The copy carries
  `conflictOf` and `conflictBase` (the fork-point content, the one provision that cannot be
  retrofitted), inherits its title unmarked, and takes a deterministic id so retries coalesce.
  Nothing in the mechanism reads a clock, so **ticket 01's skew debt is dissolved, not paid**.
  Verified by model-checking 2.4M two-device interleavings, which caught a live data-loss bug in the
  fork-point advance rule. Consequences: **ticket 03 is largely forced** (one own mirror, Firestore
  on memory-only cache as pure network transport), and the interactive merge Badrish asked for
  becomes ticket 11 rather than a step in the sync path.
- [03 · Local store](../issues/03-local-store-choice.md): **One own mirror is the source of truth**;
  Firestore runs `memoryLocalCache()` explicitly and is pure network transport. 02's conclusion
  ratified but its reasoning corrected — the two stores would never visibly disagree, since nothing
  reads the SDK cache; the real reasons are a needless second copy of the corpus on disk, bounding a
  stray `setDoc`'s blast radius to the tab, and no multi-tab cache coordination. Store is **`idb`,
  not Dexie** — a single `notes` object store keyed by `noteId` in a per-uid database, with the
  **whole corpus held in memory**, so every list, Trash, search and Outbox read is an array pass and
  **no composite index is needed (closing ticket 01's deferral)**. The **Outbox is a column, not a
  table**: `pendingRev !== null` is dirty, keeping "edit and enter the Outbox" one atomic row write.
  First load uses an `initialSyncCompletedAt` flag so a downloading new device is never mistaken for
  an empty account. Cross-tab coherence is **BroadcastChannel invalidation, no leader election**;
  the accepted gap is that one Note typed in two tabs is last-save-wins with no Conflict copy.
  **`navigator.storage.persist()` is mandatory** — unpushed Outbox edits exist only in the mirror,
  so eviction is silent loss. Accepted price: no persisted resume token means a full corpus re-read
  per app open; the `updatedAt` watermark that would fix it is rejected as the clock-skew data-loss
  trap 02 cut. Tripwire at ~2,000 Notes / ~20 MB.
- [04 · Provisioning](../issues/04-provision-accounts.md): Firebase project `notemaker-claude`
  (Firestore **Standard** edition), auth domain `notemaker-claude.firebaseapp.com`, app deploying to
  `https://note-maker-f41.pages.dev/`. Google provider enabled and the `pages.dev` host added to
  Authorised domains, both verified. The web config is recorded on the ticket — public by design,
  wired in by ticket 10 as `VITE_FIREBASE_*`. **Confirms `signInWithPopup` is mandatory**: the app
  origin and auth domain are different sites, exactly the split ticket 08 found breaks
  `signInWithRedirect`. Recommendations carried forward: don't initialise Analytics, restrict the
  API key by HTTP referrer.
- [05 · Editor and app-shell UX](../issues/05-editor-and-shell-ux.md): **The app has no concept of
  "offline"** — 02 removed online detection, so an Offline badge cannot be built honestly and does not
  exist. Every sync affordance is Outbox state about a *Note*: `Saved` vs `Saved on this device` in
  the editor, an amber dot in the list, one quiet `N notes waiting to sync` strip, no dialogs and no
  retry button. Shell is **master-detail** — persistent list beside the editor on desktop, list screen
  pushing to a full-screen editor on phone. Markdown is **typed as markup** in a plain textarea, no
  WYSIWYG, because 11's merge works on source. **There is one mode and it is Write** (Badrish cut the
  Write/Read pair); preview survives only as an invoked action, and split-pane died with it. Saving is
  debounced and *must* flush on blur, `visibilitychange` and `pagehide` or Android backgrounding eats
  writes. **Badrish's manual-save request shipped as `Sync Now` + `Auto sync`, settled 2026-08-26** —
  a button that forces an immediate drain, and an on-by-default setting that gates only the
  `begin-push` *trigger*. `pendingRev` is still minted at edit-time in both settings, so 02's
  snapshot guard stays exactly `pendingRev !== null` and does **not** widen. The names are binding
  everywhere: nothing user-facing says "push" or "manual save".
  The title latch is taught by the field itself — Derived means the input is **empty and
  the resolved title is its placeholder**, so the first keystroke is the latch and grey-versus-solid
  is the whole explanation; the one state that gets copy is Custom-but-emptied, where the user is
  trying to undo it — and **Badrish ruled the latch gets no escape hatch**, against both
  recommendations. **A Default title is never announced, only shown** (muted and italic in the
  list), and a new Note focuses the **body**, never the title. Trash opens **read-only** so an edit
  can't resurrect a Tombstone by the side door. 02's redirect is honoured as a **silent swap** —
  not one character or the selection moves, `replaceState` never `pushState`, one dismissible banner.
  Cold start distinguishes downloading from empty via 03's `initialSyncCompletedAt`, and a returning
  device has **no loading state at all**. Oversized bodies never block typing; only the sync fails,
  visibly. Prototype: [prototypes/05-shell/index.html](../prototypes/05-shell/index.html) (throwaway).
- [07 · PWA service worker](../issues/07-pwa-service-worker.md): `generateSW`, no runtime caching
  (Firestore uses IndexedDB, not Cache Storage); precache Vite's hashed shell only; **update mode is
  `prompt`** — Badrish, 2026-08-26, owned by ticket 10 because that is the ticket that ships the
  first build and locks the choice (`autoUpdate` can swap the app out mid-sentence in an editor);
  Android
  install needs 192/512 icons plus a maskable icon. **Firestore persistence cannot run inside a
  service-worker scope at all** — sync only happens while the app is open, no background sync;
  relevant to ticket 02. Detail: [research/07-pwa-service-worker.md](../research/07-pwa-service-worker.md)
- [08 · Auth offline behaviour](../issues/08-auth-offline-behaviour.md): session survives offline
  indefinitely (refresh token in IndexedDB); `onAuthStateChanged` and the Firestore cache both keep
  working when offline, only `getIdToken()` fails — gate UI on auth state, never on tokens. Use
  `signInWithPopup` (`signInWithRedirect` is broken on Chrome M115+ for our `*.pages.dev` +
  `*.firebaseapp.com` origin split). Firestore offline persistence is opt-in and must be configured
  explicitly at `initializeFirestore`. Detail: [research/08-auth-offline-behaviour.md](../research/08-auth-offline-behaviour.md)

## Not yet specified

- Note list ordering, and whether pinning exists at all *(Builder has taken `updatedAt desc`, no
  pinning, as an execution call — one comparator, trivially reversible. Still fog as a product
  question.)*
- Behaviour at large Note counts: when client-side search and a full local mirror stop being viable
- First-run experience: any *onboarding* beyond the bare empty-account screen 05 settled
- Empty, loading and error states beyond the shell ones 05 settled (it covered downloading vs empty,
  no results, offline sign-in, oversized body — not everything)
- Android integration beyond installability: share-target intent (back-button behaviour graduated
  out of here into ticket 12)
- *(The 30-day Trash purge graduated out of here into [ticket 13](../issues/13-trash-purge.md),
  2026-08-26, on Badrish's instruction to ticket it properly. Deferred out of the v1 slice: the
  Trash simply grows, which costs nothing at this corpus size. Note the product currently **promises**
  the purge in two strings in ticket 05 — 13 either implements the sentence or deletes it.)*
- Note export and backup — getting the corpus out

## Out of scope

Ruled beyond this destination. These never graduate; they return only if the destination is
redrawn, and then as a fresh effort.

- **Images and file attachments** — storage buckets, upload UI, and offline caching of binaries
- **Tags and folders** — organisational hierarchy; search covers the need at MVP size
- **Sharing and collaboration** — multi-user Notes, share links, co-editing; would force a CRDT and
  reverse the last-write-wins decision
- **Reminders and notifications** — push infrastructure and scheduled delivery
- **End-to-end encryption** — retrofit stays feasible because search is client-side
- **Native Play Store app** — Kotlin/Compose or React Native; the PWA is the Android surface
- **iOS** — not a target device
