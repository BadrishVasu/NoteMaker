# Builder's notebook — NoteMaker

## 2026-08-27 — the push was a gap, and the redaction had a second miss

Badrish asked whether the unpushed `origin/main` was intentional. It wasn't. Worth being precise
about *how* it wasn't, because the failure mode is reusable:

**I wrote a list of "steps only Badrish can perform" and the list was incomplete.** Both entries on
it were Cloudflare dashboard actions, so the list quietly became "the dashboard actions" in my head,
and the push — the step that makes those actions mean anything — was in nobody's column. Not mine
(I don't push without his word on a public repo), not his (he never saw it written down). A
handoff list is the one artifact where an omission is invisible from both ends: he can only act on
what's listed, and I stop looking once I've listed what I know. **When I write a blocked-on-Badrish
list, walk the whole path from my last commit to the thing working, and put every step on it,
including the ones I could technically do myself.**

### The redaction miss — same mistake, smaller costume

Ticket 04 still held the literal `appId`. The first redaction removed the `apiKey` and kept the rest
with the sentence "they are names rather than keys." That's the *exact* reasoning shape Badrish
corrected the first time ("public by design, therefore safe to commit"), just applied to a different
field. And it contradicted ticket 10, which already said none of the four `VITE_FIREBASE_*` values
belong in the repo — the two tickets disagreed and nobody noticed because each read fine alone.

What I'm taking from it: **a judgement-based rule regenerates the mistake it was written to stop.**
"Is this value really sensitive?" invites a fresh wrong answer per field. "Is this value carried as
a `VITE_FIREBASE_*` variable?" has one answer and no room to be clever. Mechanical beats correct-
sounding for rules that have to survive being applied by a tired agent at the end of a session.

Corollary I nearly missed: **the guard had the same hole as the document.** I only found it because
I scanned the whole tree rather than trusting that the hook's clean exit meant a clean tree. Wrote
the failing test before the new pattern, with a negative control. That's now 11 cases. Third time on
this project that testing an enforcement mechanism in both directions has paid out.

### The thing nothing was tracking

`3a8bdaa` — the commit that pasted the apiKey — **is already on the public `origin/main`**, pushed
2026-08-25. The redaction commit is not. So the live public tip still shows the key, and the only
clean copy is this working tree. Nobody had written that down anywhere; the redaction commit read
like the incident was closed, and it wasn't.

Pushing *improves* it (tip becomes clean). Rotation is the only real fix and it's Badrish's — I did
not reach for `filter-repo`, per the standing rule that rewriting history doesn't retract a value a
scanner has already read. It's on ticket 04 and in the feature file's open questions now, so it
survives me.

## 2026-08-26 — answers landed, step 0 built, first code in the repo

Badrish answered all three. The org stopped specifying and started building.

### What I got wrong, and want to remember

**My flat-config ESLint boundary silently didn't work.** I layered four config objects each
declaring `no-restricted-imports`, assuming they'd merge. They don't — a later matching object
**replaces** the rule wholesale. Net effect: the firestore boundary was disabled for most of `src/`
and the `domain/` purity rules were disabled entirely, while `npm run lint` reported a clean tree.

The only reason I know is that I wrote the boundary test *first*, with negative controls, exactly as
the pinned credential-hook memory says to. A guard that matches nothing and a codebase with no
violations look identical from outside. This is the second time on this project that lesson has paid
out, and it is the strongest argument I have for why the import boundary needed a test rather than a
code review. **Every enforcement mechanism gets tested in both directions. No exceptions.**

Config that "looks obviously right" is exactly where this hides, because nobody writes tests for
config. `src/test/importBoundary.test.ts` is where that now lives.

### Judgement calls I took alone, and why I think each was mine

- **`initializeFirestore` moved from `platform/firebase.ts` into `sync/firestoreGateway.ts`.** The
  Designer's module table put it in `platform/`, which would have required an exception to my own
  import boundary on day one. A boundary with one sanctioned exception grows a second. Nothing
  outside the gateway needs a Firestore handle, so the move costs nothing and makes the rule
  absolute. Small, reversible, strengthens his own stated rule — took it, recorded it in the file.
- **`deviceId`**: `meta` store, per-uid, `crypto.randomUUID()` truncated to 8 chars, never rotated,
  with a length check on the composed copy id. Short because it lands in a Firestore document id
  and a conflict-of-a-conflict nests the pattern. Considered sending this to the Mathematician
  against my own trigger list — it *is* in a document id, which is permanent. Concluded no: the copy
  id **scheme** was already fixed by his appendix (`<noteId>__c<deviceId>__<flightRev>`), so I was
  only choosing where the value is stored and how long it is. That's storage, not scheme.
- **Push trigger policy** taken as mine — it is `engine.ts`-internal and reversing it is one
  function. Nobody contested it in two sessions; waiting longer would have been deference theatre.
- **Preview deployments can't sign in, accepted rather than fixed.** The alternative widens the API
  key's referrer allowlist across every generated subdomain forever, and Firebase Auth wouldn't
  wildcard the domain anyway. Previews prove the build; production proves auth.

### Two of my seven gaps closed without me

The Mathematician's appendix answered gap 5 (per-Note pushes are fully independent — I withdrew my
serialised-drain holding position) and gap 7 (`applySnapshot` with an absent `serverDoc` — cells 1,
3, 7 of the table). Worth noting how that went: I raised both, held a safe default on one, and got
better answers than I'd have reached alone. **Cell 7 — dirty row, server doc gone, no-op — is the
one ticket 13's purge must not be allowed to break**, and I wrote that into 13 so it isn't
rediscovered.

### Dead ends and things not to re-open (adds to the list below)

- **Layered ESLint rule declarations.** See above. Each scope declares its complete set.
- **Automating the Firestore rules deploy in CI.** Needs a `FIREBASE_SERVICE_ACCOUNT` secret to save
  perhaps three deploys over the project's life. Bad trade today; becomes good the moment rules
  churn, and then it is a ticket. The guard that matters is the emulator test, which needs no secret.
- **A second Firebase project for previews.** Own provisioning, own rules deploy, own allowlist, for
  a preview that still couldn't authenticate.

### Corners cut, stated rather than hidden

- **The PWA icons are placeholder art** — three generated PNGs, a page glyph on the theme colour.
  They are real, valid, correctly sized files and the install will work; they are not designed.
  Real icons are UI/UX's at step 6.
- **`firestore.rules` does not exist yet**, so `npm run rules:deploy` would fail today. Deliberate:
  rules land at step 5 with their emulator tests written first, per ticket 01's amended field set.
  Writing them now would be implementation ahead of a test.

### Where I am

Step 0 is built and verified locally — tests, lint, typecheck, production build, and the page
mounting in a real browser with auth state resolving. It is **not deployed**, and that is on two
Cloudflare dashboard actions only Badrish can perform. Step 1 (`domain/title.ts`) is unblocked and
needs nothing from anyone. Step 2 blocks on the Designer's literal `NoteDoc`/`LocalNote` types.

## 2026-08-25 — read the whole decision record, responded to the architecture

First session. Read 01–12, CONTEXT.md, the map, designer's and ui-ux's notebooks, and the Designer's
`.scratch/notes-mvp/architecture.md` (which was written *while* I was reading — it landed mid-session).
My full assessment is in that file's `## Builder's response` section. Not restated here.

### The shape of this build, as I hold it

Three constraints do all the work and everything else is downstream of them:

1. Every Note write goes through `runTransaction`. One stray `setDoc`/`addDoc`/`writeBatch` anywhere
   silently reintroduces the whole data-loss class. The Designer's import boundary (only
   `sync/firestoreGateway.ts` may import `firebase/firestore`) is a **better guard than 02's name
   list**, because a name list can't anticipate `addDoc`. But it needs a second, intra-file
   assertion that inside that one file the only write path is `runTransaction` — the boundary stops
   the call being written elsewhere, not being written wrongly there.
2. Unpushed edits exist **only** in the local mirror. Anything that can clear that store is data
   loss, not a cache miss. `navigator.storage.persist()` is not a nicety.
3. `domain/` takes no clock. 02 dissolved 01's clock-skew debt precisely because reconciliation
   reads no time. A `Date.now()` under `domain/` silently un-proves the thing that was proved.

### Gaps I found that the tickets do not cover

Detail in architecture.md; the list, so I don't re-derive it:
`deviceId` is minted nowhere · 01's rules predate `rev`/`conflictOf`/`conflictBase` and will reject
every Conflict copy · nothing triggers a push (no online detection, so wake sources need deciding) ·
`conflictBase` halves the effective body cap so 05's 1 MiB threshold is wrong · push concurrency
across Notes undefined · the purge is a *write* and is unspecified · `applySnapshot` has no defined
behaviour for an absent `serverDoc`.

### The one I'd have missed if I hadn't counted it

03 prices the full re-read per app open against a 50k/day quota assuming desktop-shaped opens. The
design's own premise is that **Android reaps the app constantly**, so opens are 20–50/day, not one.
At 500 Notes that is already at 03's own tripwire. Not reversing it — `persistentLocalCache` is the
sanctioned one-line reversal and the `updatedAt` watermark stays dead — but the number must be
*measured* at step 7, not inherited.

### Sent to the Mathematician

02's model interleaved `edit`/`delete`/`begin-push`/`commit-push` — **`snapshot-delivered` is not in
that list**, yet 02's second trap is entirely about snapshots. So that trap was likely reached by
reasoning, not by the check, and `applySnapshot` is the one part of the mechanism carrying an
unverified invariant. Asked for a re-run with snapshots as an event, plus a complete
`applySnapshot(localRow, serverDoc)` decision table I can turn straight into unit tests, plus whether
concurrent per-Note pushes break any cross-Note invariant. The Designer independently asked it a
different question (does Firestore's transaction-retry re-execution admit an interleaving the model
ruled out) — both are with it, neither needs sending twice.

### Dead ends and things not to re-open

- **`navigator.onLine` / any offline badge.** Dead by 02, and ui-ux's notebook already burned a
  draft on it. The connectivity oracle that *is* honest is snapshot delivery: a delivered snapshot
  proves the transport is up and costs nothing. Use that to wake the push loop.
- **Manual save as a mode.** If built as a mode it widens 02's dirty predicate beyond
  `pendingRev !== null`, which needs a second stored field — exactly what 03 killed the `synced`
  boolean for. Put a `Push now` button to Badrish instead; same control, invariants don't move.
- **A store library for the corpus.** One array, one subscribe. But `useSyncExternalStore` over a
  single whole-corpus snapshot re-renders every row on any change; the fix is immutable rows in a
  `Map` with stable identity, not a library.

### Positions I've taken so nobody waits on me

- List ordering `updatedAt desc`, no pinning. One comparator, trivially reversible.
- Serialise the Outbox drain until the Mathematician says per-Note pushes are independent.
- No build team before step 6. Steps 0–4 are pipeline plus pure logic; specialists there cost
  coordination and buy nothing.
