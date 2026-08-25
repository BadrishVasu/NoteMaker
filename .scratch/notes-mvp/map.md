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
- [04 · Provisioning](../issues/04-provision-accounts.md): Firebase project `notemaker-claude`
  (Firestore **Standard** edition), auth domain `notemaker-claude.firebaseapp.com`, app deploying to
  `https://note-maker-f41.pages.dev/`. Google provider enabled and the `pages.dev` host added to
  Authorised domains, both verified. The web config is recorded on the ticket — public by design,
  wired in by ticket 10 as `VITE_FIREBASE_*`. **Confirms `signInWithPopup` is mandatory**: the app
  origin and auth domain are different sites, exactly the split ticket 08 found breaks
  `signInWithRedirect`. Recommendations carried forward: don't initialise Analytics, restrict the
  API key by HTTP referrer.
- [07 · PWA service worker](../issues/07-pwa-service-worker.md): `generateSW`, no runtime caching
  (Firestore uses IndexedDB, not Cache Storage); precache Vite's hashed shell only; update mode
  (`autoUpdate` vs `prompt`) must be chosen before first deploy, not switched later; Android
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

- Note list ordering, and whether pinning exists at all
- Whether the 30-day Trash purge runs client-side on open, or needs a scheduled Cloud Function
- Behaviour at large Note counts: when client-side search and a full local mirror stop being viable
- First-run experience: what a brand-new account sees before it has any Notes
- Empty, loading, and error states across the app
- Android integration beyond installability: back-button behaviour, share-target intent
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
