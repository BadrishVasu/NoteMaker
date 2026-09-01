# Builder's notebook — NoteMaker

## 2026-09-01 — verifying a deploy without being able to log in

The deploy works. The interesting part is *how* I got to a real confirmation given the one thing I
categorically cannot do is authenticate a Google account.

### The move worth remembering: find the non-authenticating probe

The naive read is "sign-in can't be verified by an agent, so report the preconditions as unverified
and hand it to Badrish." That would have been true and useless. The better question was **what does
the SDK itself do before it opens the popup** — and the answer is a plain `GET` to Identity Toolkit's
`getProjectConfig`, no credentials involved. Issued *from the deployed origin*, a 200 collapses three
separate unknowns at once:

- the API key is real and enabled — a placeholder returns 400 `API_KEY_INVALID`
- the HTTP-referrer restriction genuinely permits this origin — a blocked one returns 403
  `API_KEY_HTTP_REFERRER_BLOCKED`
- and the response body *hands you* `authorizedDomains`, which is the Firebase Auth list itself

That last one also closed the `localhost` question I'd left open on 2026-08-27 as "not verifiable
from here, but almost certainly fine." It was fine — but I'd written a guess into the logbook and it
sat there for four sessions. **The generalisation: when a step is blocked because it needs a human,
ask what the machine does immediately *before* that step. The precondition is usually queryable even
when the action isn't.**

### My first shape check silently found nothing, and the control caught it

I regexed the deployed bundle for `["'](AIza[0-9A-Za-z_-]{35})["']` and got **no match** — which,
read carelessly, says "the env vars didn't reach the build." I nearly had a false alarm rather than a
false pass, which is the same disease in the other direction.

What saved it was running the regex against a **known-good fake string** first. It fired. So the
regex worked and the bundle was the thing that differed — esbuild had emitted the value inside
**backticks**, and my character class only allowed `"` and `'`. Five minutes, and the difference
between "the deploy is broken" and "my check was wrong."

This is the fifth time on this project that testing a check in both directions has paid out, and the
first time the failure was a **false negative** rather than a false pass. I'd internalised "a guard
that matches nothing looks like a clean repo." The mirror is just as expensive: **a check that
matches nothing looks like a broken system.** Positive control before you believe a negative result,
not just before you believe a positive one.

### Answering the rotation question without touching either value

Badrish never said whether he rotated. Rather than ask him and burn a blocking question, I hashed the
deployed key inside the page and compared the SHA-256 prefix to a hash of the value in git history at
`3a8bdaa`. Different — so he rotated. **A hash prefix is not a credential**, so this answered a
question about two secrets while handling neither, and nothing quotable entered the transcript.

Where I stopped: I wanted to know whether the *old* key still works, which is the half that actually
ends the exposure. The permission classifier blocked the request, correctly — it looks exactly like
transmitting a credential, because it is. I did not route around it. It goes to Badrish as a one-look
console check. **Worth noting the block was right and my intent was defensible at the same time; the
lesson isn't "the classifier was wrong," it's that the last step of a security check often belongs to
the human by construction.**

### On not spawning QA

I brought in Operations (deploy is its domain, and it re-derived the commit tie independently, which
is the whole point of a second agent) and deliberately **did not** spawn QA. QA has no browser and no
`WebFetch` — it could only have reached the live site through `curl`, duplicating Operations, and the
one thing genuinely left is a Google sign-in no agent may perform. Spawning it would have been
process theatre. Recording the reasoning because "the brief mentioned QA" is exactly the pressure
that produces a pointless spawn.

### A loose end I chose to name instead of dress up

I tried cross-checking local vs deployed JS byte counts (290956 vs 290950) against the env value
lengths. **It didn't reconcile**, even after accounting for quoting in `.env.local`. Minification and
local Node 24 vs deployed Node 20 both confound it. The honest move was to discard it rather than
find an arithmetic that made it land — Operations' byte-identical env-independent assets settle the
tie properly and don't need my worse check propping them up. **A weak check that half-agrees is worth
less than no check, because it invites you to reason backwards to the answer you already want.**

## 2026-08-27 — the documentation gap I'd have called a user error

Badrish asked how to run it locally and described hand-editing the values into `firebase.ts` and
reverting after. The easy read is "that's the pattern that caused the exposure, tell him not to."
The honest read is worse for me: **he reached for it because nothing in the repo told him anything
else.** Ticket 10 documents the deployed path in detail. `.env.example` says "copy to `.env.local`",
which presumes you already know that's the whole mechanism. Neither says `npm run dev` anywhere.

This is a new shape of the omission I wrote up last session. That one was a handoff *list* missing a
step. This one is a path that never got a list at all, because every person who could write it
already knew it. **The steps most likely to go unwritten are the ones the writer does without
thinking.** When I document a path, the test is not "is each step correct" but "could someone who
has never run this follow it" — and if the answer requires knowing what `import.meta.env` implies,
it isn't written yet.

### The port pin, and a negative control that took three tries

Ticket 04 lists `localhost:5173` and `localhost:4173` on the key's referrer restriction *explicitly*,
noting port wildcards aren't honoured. Vite's default is to increment past a busy port. So a taken
5173 becomes 5174, and 5174 gets `403 Requests from referer ... are blocked` at sign-in. Auth-shaped
error, port-shaped cause, one dim line in the banner as the only evidence — and Badrish has told me
directly that an auth failure at sign-in reads to him as a bug. Pinned with `strictPort` so it
refuses to start instead. Test first, red 3/3, green.

Then the part worth writing down. My first two negative controls **both silently failed to test
anything**: I occupied `5173` on a wildcard address, then on `127.0.0.1`, and Vite started happily
on 5173 both times — it binds `::1` on this machine. Had I stopped at either, I'd have recorded
"verified" for a check that never ran, which is the precise failure I've now caught four times on
this project in other people's work and just produced twice in my own in five minutes. What saved it
was that the control had a *predicted* outcome ("vite must exit with an error") and I checked
against that, not against "did something happen." **A negative control needs an expected observation,
or it's a ritual.** The one that worked: run a second `vite` against a running one.

Corollary for Windows specifically: **binding `127.0.0.1:<port>` does not occupy that port.** I'll
hit this again.

### Small thing that'll bite someone

`.env.local` already exists on his machine with placeholder values. `readConfig()` throws only on
*missing* names, never on invalid ones — so placeholders sail past the loud boot-time guard I wrote
to catch exactly this, and surface as `auth/api-key-not-valid` at the popup instead. The guard is
still right (a missing var is the Cloudflare failure mode it was written for), but its existence
made me assume misconfiguration was covered, and it covers half. Failure table on ticket 10 now
leads with the placeholder case.

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
