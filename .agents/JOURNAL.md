# NoteMaker — journal

Newest entry first. Append only.

## 2026-08-25 — ticket 02 resolved: the conflict-copy mechanism
**Worked:** claude, mathematician
**Moved:**
- **02 closed.** The SDK's offline queue is never used for Note writes; every write goes through
  `runTransaction`, which rejects offline rather than queueing, so unconditional replay becomes
  structurally impossible. Edits sit in our own Outbox until reconnect, where one transaction
  compares the server's `rev` against the Fork point. `rev` is an opaque token, not a counter.
  Detection is three equality tests and reads no clock, so **ticket 01's clock-skew debt is
  dissolved rather than paid**. Mathematician model-checked 2.4M two-device interleavings and
  caught a live data-loss bug in the fork-point advance rule before it shipped.
- Two facts settled the architecture and are worth not re-deriving: `runTransaction` rejects when
  offline instead of queueing, and a pending local write hides the server's version from the app.
  Together they mean a conflict **cannot** be detected after the fact — the reconcile-afterwards
  option the ticket floated is dead.
- **Ticket 03 is now largely forced** and should be ratified, not reopened: one own mirror as
  source of truth, Firestore on memory-only cache as pure network transport. Noted on 03.
- **Ticket 11 created** — reviewing and merging a Conflict copy, a `prototype` ticket blocked on
  02 and 05. This graduated from the map's fog when Badrish asked for an interactive merge.
- `CONTEXT.md`: cut **Sync watermark**, which named nothing in a design that is deliberately
  time-free; added **Outbox** and **Fork point**, which it does need words for.
- Ticket 09 told what it now owes, chiefly a test that no `setDoc`/`updateDoc` ever touches a Note.

**Open:** frontier is now **03** (unblocked by this), **05**, **10**. Then 06 and 09 behind 03,
and 11 behind 02 and 05. Designer takes the architecture once 03 closes.
**Badrish:** asked for an interactive merge where he picks which differences land; accepted moving
it out of the sync path so the automatic Conflict copy is always the floor. Also set the standing
rule that the agent team is an organisation that should pick up and build from the first prompt —
he and Claude work the basic plan only, and the agents take the specifics to him directly rather
than having Claude pre-analyse and hand over a pre-digested brief.

## 2026-08-25 — logbook opened
**Worked:** claude
**Moved:**
- Opened this logbook. Nothing about the build changed; the record just now exists.
- Seeded the entry below from git history and ticket state so the record starts from
  where the project actually is, not from today.

**Open:** frontier is tickets 02, 05, 10 (see below). Ticket 02 is the Mathematician's.
**Badrish:** set the standing rule that agents speak to him directly and that progress is
written down on two axes — project→feature and project→session. This file is the second axis.

## up to 2026-08-25 — charting, reconstructed from git and `.scratch/`
**Worked:** wayfinder charting session(s)
**Moved:**
- Charted the map at `.scratch/notes-mvp/map.md` with ten decision tickets; destination is
  a deployed, installable, daily-used PWA on `*.pages.dev` — running, not specified.
- Resolved **01** (Firestore data model and security rules), **04** (Firebase + Cloudflare
  accounts provisioned — the HITL one), **07** and **08** (the AFK research pair; findings
  in `.scratch/notes-mvp/research/`).
- Corrected ticket 04 twice after the fact: the auth domain must be allowlisted, and an
  HTTP 400 from the referrer probe means an invalid key rather than a blocked one.
- Added `.gitignore` ahead of the Vite scaffold. No application code exists yet.

**Open:**
- Frontier — open and unblocked: **02** conflict-copy mechanism, **05** editor/app-shell UX
  prototype, **10** Cloudflare Pages build config and Firebase env vars.
- Still blocked: 03 (on 02), 06 (on 03), 09 (on 02 and 03).
- **02 is the hard one** and is explicitly the Mathematician's: Firestore's offline queue
  replays writes unconditionally on reconnect, which silently discards the losing edit, so
  last-write-wins *with a conflict copy* needs our own version field plus a transactional
  check. Expensive to unwind, everything downstream commits to it.
- Designer takes the architecture once 01–03 close. Builder leads implementation after that.

**Badrish:** chose Firebase Firestore + Firebase Auth against the recommendation, with the
LWW caveat stated and accepted. Also flagged (in `BadrishTTR.txt`) that Cloudflare preview
deployments get generated subdomains no current referrer entry matches — add
`https://*.note-maker-f41.pages.dev/*` or accept that previews can't authenticate.
