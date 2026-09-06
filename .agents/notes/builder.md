# Builder's notebook — NoteMaker

## 2026-09-06 (fourth) — a checkbox's *wording* cost Badrish a round trip

Badrish asked me for an `.apk`. There is no `.apk`; there never will be. He asked because a checkbox
I wrote said **"Installed to an Android homescreen"**, and to anyone who is not already holding the
PWA decision in their head, "installed" means a package.

The lesson is narrower than "write clearly", and it is the one I want to keep: **a task written as a
noun (an outcome) inherits whatever mechanism the reader already associates with that noun. A task
written as a verb (the act) supplies its own.** "Installed to an Android homescreen" vs "open the
live URL in Chrome and accept the install prompt — nothing is built or downloaded". Same fact, and
only the second one can't be misread. Every remaining Badrish-action box in this project is now the
second shape, and new ones should be written that way from the start.

Second-order, and the reason it mattered at all: **that box was next to a stale one.** Sign-in had
been done for some unknown stretch while the file still called it "the only step left". A reader
looking at an out-of-date list has no way to tell which items are real, so they read the whole list
harder than it deserves — which is exactly what happened. Staleness doesn't just misinform, it makes
the *accurate* neighbours cost more attention.

Both of those are the same 2026-09-01 lesson arriving from a new direction: an action succeeding
silently falsifies documents nobody re-reads. I swept with grep rather than recall again and it paid
again — ticket 10's Badrish-steps list would have had someone re-running three finished Cloudflare
actions.

One thing I deliberately did **not** do: chase the "believed to work on research alone" line in
ticket 10's Overseer flag, or the "It is not deployed" lines in old journal/notebook entries. Those
are dated records of what was true when written. Correcting history in place is the thing LOGBOOK.md
forbids, and the fix for a superseded record is a newer record, not an edit.

## 2026-09-06 (third) — the Mathematician's baseContent answer, folded in

Landed. Short version of what it cost and what it bought: **zero code changes to what I shipped, and
a rule I would have got wrong at step 3 in three separate places.**

### What I got right, and why it was worth the wait

Refusing to pin `assertRowInvariant` on the Designer's reasoned claim was the correct call and it is
the one I want to remember the *shape* of. The predicate came back confirmed exactly — so on the
surface, waiting bought nothing. It did not: the same run that confirmed my predicate disproved the
rule that predicate was written to protect, and found a gap that writes a permanently-wrong
`conflictBase` to a real server document. If I had shipped on the reasoned claim I would have shipped
a green suite over a broken engine rule and never known, because the suite *cannot see it*.

That is the lesson, sharper than "ask the Mathematician on hard things": **a check confirmed correct
is not a check that covers what you wanted covered.** `P-INV` survived ~900k states against the
defective design without firing once. It is a shape check. I let its name and its placement imply a
correctness guarantee it never had, and the doc comment I wrote said as much ("captured on the
clean→dirty transition and again on commit of a clean push") — stating the disproven rule as fact,
inside the guard, where the next engineer would read it as authoritative. Fixed: the comment now
states the corrected rule, names itself a shape check, and points at where the lineage assertion
lives. Comment-only, no behaviour, so no test moved.

### The three gaps, in my own words, so I recognise the pattern rather than the instances

Every one of them is the same error, and it is not the Designer's alone — I read those two capture
points and did not flag them:

> The rule was keyed to a **branch** ("commit of a clean push") when the fact it protects is a
> **state change** ("`baseRev` moved"). Branch-keyed rules go stale the moment a branch is added.

There were four branches that move `baseRev`, not one, plus a fifth transition that isn't a
transaction branch at all — the outbox-slot migration from *my own* defect-3 fix, which nobody's
rules mentioned. That last one is the one to sit with: a correct fix to defect 3 created a new
`baseRev`-advancing transition, and the capture rule, being keyed to branches, silently did not
cover it. My own patch aged out someone else's rule and neither of us noticed.

Wherever I write an invariant from here: state it against the state change, then enumerate the
transitions that produce it, and treat "I added a branch" as an event that re-opens every rule.

### Booked, not built

The corrected rule and the lineage assertion are on `features/sync-engine.md` under Decisions, with
Gaps A/B/C named as regression tests carrying the Mathematician's own traces as their bodies. I did
**not** build them this session and that is deliberate — `domain/reconcile` does not exist, and a
fixture written before the unit it tests is a fixture written against an imagined signature. The
prerequisite is recorded loudly enough that step 3 cannot start without it: the reconcile tests need
a fixture that **remembers content per rev**, because without it the lineage assertion cannot be
written at all.

One thing to carry into step 3 and not argue with: **appendix cell 7 retains `baseContent` on a
dirty row with an absent server document, and that is correct.** It looks exactly like a leak. The
model reaches the trace where that retained value is later written as a *right* `conflictBase` after
another device recreates the doc. It is flagged on `sync-engine.md` as do-not-clean-up; I am
recording it here too because it is the kind of thing a future me tidies away in a refactor.

### Sent, this session

Both Designer items in one invocation rather than two — the capture-rule correction (with the
Mathematician's branch-vs-state-change point passed through verbatim, since it generalises past this
bug) and the `sameContent`/`ForkPoint` `deletedAt` contradiction, with my position that seam #4
moves to the reconcile against `ServerState`. Batched because step 3 consumes both and a second
round trip buys nothing.

## 2026-09-06 (later) — a document said a file existed, and I believed my own journal

Three things worth keeping from the first session that actually produced application logic.

### The correction I have to carry, and the one I nearly repeated

Badrish corrected the entry below: the `extends` guard is "still the first test written at step 2"
is **wrong**. The assertion goes on the object the gateway hands the transaction, and no gateway
exists until step 4 — so there was nothing at step 2 for it to sit on. My reasoning about *where*
the guard belongs was right and is unchanged; I then wrote down a *when* that my own reasoning had
already ruled out, and did not notice because the two sentences were in the same paragraph. It is
now on `features/sync-engine.md` at step 4, three steps early, so it survives.

The generalisation: **when I move a decision, I have to re-derive everything the old placement
implied, not just restate the new one.** Moving the guard off `toNoteDoc` also moved it off step 2,
and I carried the schedule across unchanged because it was attached to the sentence rather than to
the reasoning.

The bigger one is worse. My own journal entry said **"`src/domain/note.ts` exists as literal,
compiling types."** It did not exist. The Designer's artifact was a fenced code block inside
`architecture.md`, the commit `0e32dce` was titled "Land the literal NoteDoc/LocalNote types", and
I wrote the entry from the artifact rather than from the tree. Badrish caught it, not me — and I
would have opened step 2 next session against a file that isn't there.

**Nothing in the logbook may assert that a file exists without the assertion having been checked
against the tree.** This is the same disease as the ticket-10 line that went stale when the push
made it wrong, except faster: it was false the moment I wrote it. `git status` is one command and
it is the difference between a record and a story about a record. A commit *title* is not evidence
of what the commit contains.

### The suite went green on the first run, so I attacked it

Step 2's contract suite passed 64/64 immediately. On this project that is a warning, not a result —
it is the fifth variant of the lesson that a guard matching nothing and a clean codebase look
identical. So I mutation-tested it: eight deliberate breakages of each store (drop the invariant
guard, drop the clone on `get` / on `getAll` / on `put`, drop rollback of notes, of meta, of both).

**Seven were caught. One was not:** removing the clone from `getAll` changed nothing, because my
aliasing test only used `get`. And `getAll` is the read the *corpus* is built from — the one whose
rows the entire UI holds and can mutate. The exact path that matters was the untested one, and the
test I *had* written was the one that felt representative.

New thing here, beyond "test in both directions": **a negative control tests one path, not one
property.** I'd been treating "I proved copies-not-aliases" as a property-level result when it was
a single-call-site result. When a store has four read paths, the mutation has to be tried on each.
Cheap: the whole exercise was one scripted loop and about four minutes.

Second-order: the two mutations that "PATTERN NOT FOUND" on my first attempt were a CRLF/LF
mismatch — PowerShell `.Replace` against files written with `\n`. That failure mode is *silent in
the direction that flatters me*: a mutation that never applies reports as a pass. I only caught it
because two of eight reported not-found while others worked. If all eight had silently no-op'd I'd
have recorded "suite verified" for an exercise that ran nothing. **Same shape as the negative
control that needs a predicted observation — a mutation harness needs to prove the mutation landed,
not just that the run finished.**

### Enforce the invariant, don't assert it

`baseContent !== null ⟺ pendingRev !== null && baseRev !== null` could have been a test that builds
rows and checks them. That proves the test correct. I put it in `assertRowInvariant`, called on
every write in both stores, so no path can put a violating row on disk — and the suite then proves
*the stores* enforce it. **Identical reasoning to moving the `extends` guard onto the gateway's
object**, which is a small sign the rule is real rather than a one-off: guard the choke point, and
let the suite prove the choke point is closed.

The cost is that a wrong predicate now *rejects legitimate rows* rather than merely failing to
catch bad ones, which is why it is on two feature files as pending the Mathematician. Contained —
one function, nothing consumes the store yet.

### On not spawning anyone

Steps 1 and 2 are ~400 lines of pure logic and one port with two implementations. A build team here
would have cost coordination and bought nothing, exactly as I wrote at step 0. The one agent that
earned its spawn was the Mathematician, and only because the question hits two of my own mandatory
triggers (unrecoverable if captured wrong; surfaces late, at ticket 11). Sent in parallel at the
top of the session, per my own deferral note — the point of the deferral was that the answer land
in a session holding the work, and it did.

## 2026-09-06 — the artifact I was owed found a bug in the spec I'd already read twice

The Designer delivered the literal types. The headline isn't the types — it's that **writing them
out found a hole that reading the tickets did not**. I read 01, 02 and 03 in full on 2026-08-25 and
listed seven gaps out of them. `conflictBase` having nowhere to come from was not one of them, and
it was sitting in plain sight across two documents: 02 says a Conflict copy must carry the
fork-point content, 03 says the row is `baseRev`, `pendingRev` "and nothing else". Each reads fine
alone. That is the *third* time on this project a contradiction has survived because it was split
across two documents that were each internally consistent (ticket 04 vs 10 on the config values;
ticket 10 vs the pushed tip on the key). Same disease.

**The generalisation worth keeping: prose specifications don't have to typecheck, so writing the
types is itself a check, and it's a cheaper one than the code that would have found this at step 6.**
The failure would have surfaced as merges that "work" — no error, no stuck Outbox, just a
permanently two-way merge that can't tell "I added this line" from "they deleted this line". Late,
silent, and unrecoverable because the value was never captured. I should treat "turn the prose into
literal types" as a *verification step* I schedule deliberately, not as clerical work that unblocks
a build step.

### Where I moved the Designer's guard, and why the original wasn't enough

Decision #5 — `LocalNote extends NoteDoc` — takes ergonomics over structural safety and pays for it
with one runtime test. I accept the trade; nesting turns every access into `row.doc.title` forever,
and that's a real tax on every file in the app.

But the proposed test asserts `Object.keys(toNoteDoc(x))` matches the expected key set. **That test
can only fail if `toNoteDoc` is wrong.** The leak `extends` actually creates is a write path that
never calls `toNoteDoc` at all — someone hands the transaction a `LocalNote` directly, it structurally
satisfies `NoteDoc`, it typechecks, and `baseContent` (a full body copy) goes over the wire. The test
as named passes cheerfully through that.

So the assertion moves onto **the object the gateway hands the transaction**. Same cost, catches the
class instead of the instance. This is the same move as the ESLint import boundary vs ticket 02's
name list: guard the choke point, not the well-behaved function. And it's my own mechanical-beats-
correct-sounding rule applied to my own peer's design rather than to a document.

Still first test at step 2. That's on me now.

> **Corrected 2026-09-06 (Badrish).** The placement above is wrong: the assertion belongs on the
> object the gateway hands the transaction, and no gateway exists until **step 4** (`fakeGateway`),
> so it cannot be the first test at step 2. The reasoning that moved it off `toNoteDoc` is
> unchanged. Now recorded on `features/sync-engine.md` at step 4. See the newer entry at the top.

### The Mathematician question — deferred deliberately, and the reason is not "it's small"

`baseContent`'s two capture points hit two of my own mandatory triggers: expensive to unwind (the
value is unrecoverable if captured wrong) and surfaces late (as a degraded merge, at ticket 11).
So it goes to him — the only question was when. I sent it to *next* session's opening rather than
now, because there is no step-2 work in this session to consume the answer, and an answer that
arrives into a context nobody is holding is an answer that gets re-derived. It's on the feature file
and in the journal so the timing is a decision rather than a lapse. If I find myself at step 2's
invariant test without having sent it, that's the failure, not the deferral.

Worth noting the Designer flagged this itself rather than asserting it. Four decisions offered for
challenge, one referred up. That's the behaviour that makes the artifact trustworthy — the
alternative is a document where I can't tell reasoned-and-verified from reasoned-and-hoped.

## 2026-09-01 (later) — closing a question is a write, and it has the same failure modes

Badrish answered the rotation question: rotated **and retired**. Short session, one commit, but two
things in it are worth keeping.

### The stale record I didn't know about

I knew two documents were stale, because I'd written both open questions myself. Operations found a
**third** — ticket 10's line saying the literal key was "still in the file at the public tip", which
the 2026-08-27 push had falsified weeks earlier and which nobody re-read after pushing. I only caught
it because I grepped for the *fact* (`rotat|revok|retire|old key`) before assigning, instead of
handing over the two locations I remembered.

The generalisation, and it's the same shape as the handoff-list omission from 2026-08-27: **the
places I remember writing are the places I'll fix; the stale ones are the ones I've forgotten I
wrote.** Recall is the wrong index for a correction sweep. Grep for the claim, not for the file.

Second-order point: that ticket-10 line went stale as a *side effect of an action succeeding*. The
push made it wrong. Nothing prompts you to re-read a document when a different action invalidates it,
which is exactly why it sat wrong for five days. Worth a habit — after an action that changes a
world-fact the repo asserts, sweep for the assertion.

### Closing by assertion is fine; closing without provenance is not

The temptation was to just delete the open question and mark it resolved. The thing that makes the
record honest a year from now is one clause: *who* said it and *how they knew*. "Badrish confirmed,
2026-09-01, his assertion, not a console check by any agent" costs nothing and is the difference
between a reader trusting the line and a reader having to re-derive it. A resolved item with no
provenance is indistinguishable from a guess someone got tired of tracking.

I also sharpened Operations' `None open as of 2026-09-01.` — accurate, but a cold reader takes "no
open questions" as "feature done", and three `State` boxes are still unchecked. Pending *actions* and
unanswered *questions* are different things and the file now says which is which.

### On extending an authorisation

Badrish authorised "correct it and push". Operations correctly refused to read that as covering its
own notebook commit and left it local for me to decide — a good instinct, and I'd rather it erred
that way. I pushed it with the session's logbook entries and told him I'd widened his authorisation
to the session's own record, with the reason. Holding the logbook back while pushing the fix
recreates the exact drift we just spent a commit correcting, but that's my reasoning, not his
instruction, so it goes in front of him rather than into a silent decision.

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
