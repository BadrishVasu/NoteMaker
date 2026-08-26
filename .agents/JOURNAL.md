# NoteMaker — journal

Newest entry first. Append only.

## 2026-08-26 — Badrish's three answers land; step 0 built; first application code in the repo
**Worked:** builder, designer (earlier in the session)

**Moved:**
- **The project stopped specifying and started building.** Badrish answered all three open
  questions, and step 0 of the architecture's build order is **built and verified locally**: Vite +
  React + TS + Vitest, the ESLint import boundary, `vite-plugin-pwa` on `registerType: 'prompt'`,
  PWA manifest with real icons, and a sign-in smoke screen that renders a uid and nothing else.
  Tests, lint, typecheck and a production build all pass, and the page mounts in a real browser with
  auth state resolving. **It is not deployed** — that is blocked on two Cloudflare dashboard actions
  only Badrish can perform, listed on ticket 10 and in `features/deploy-pipeline.md`.
- **Badrish's answers, and where each landed:**
  1. **Service-worker mode `prompt`** → ticket 10 (which now owns the choice), `map.md`'s 07 entry,
     `vite.config.ts`, `architecture.md`. This was the last input ticket 10 was waiting on.
  2. **`Sync Now` + `Auto sync`** → ticket 05's manual-save section is now settled, not open. The
     button forces an immediate drain; the setting is on by default and gates **only** the
     `begin-push` trigger. `pendingRev` still mints at edit-time in both settings, so 02's snapshot
     guard stays exactly `pendingRev !== null` and does not widen. **The naming is binding on every
     surface** — nothing user-facing says "push" or "manual save".
  3. **30-day Trash purge** → **ticket 13 created**, deferred out of the v1 slice. It records the
     thing that would otherwise be discovered late: the purge is a *hard delete*, the only Note write
     that is not an edit, and it must not break the appendix's cell 7 (dirty row + absent server doc
     = no-op). Also flags that the product currently *promises* the purge in two strings; 13 either
     implements that sentence or deletes it.
- **All three defects from the Builder's readiness pass are fixed in the artifacts:** ticket 01's
  security rules amended to the full nine-field set (they would have **rejected every Conflict
  copy**, producing a permanently stuck Outbox behind a strip saying everything was fine); ticket
  05's sync threshold corrected from ~1 MiB to **~450 KiB** because a Conflict copy carries two
  bodies in one document; and the push-trigger policy taken as the Builder's and written down
  (wake on edit / visible / snapshot delivery / backoff / `Sync Now`; 1s→60s backoff; 10s per-push
  timeout).
- **Two of the Builder's seven gaps closed without him** — the Mathematician's appendix had already
  answered per-Note push independence (the serialised-drain holding position is withdrawn) and
  `applySnapshot` with an absent `serverDoc`. `deviceId` is settled: `meta` store, per-uid,
  `crypto.randomUUID()` truncated to 8 chars, with a length check on the composed copy id.
- **The import boundary test caught a real bug in the boundary itself.** Four layered ESLint config
  objects each declaring `no-restricted-imports` do **not** merge — a later match replaces the rule
  wholesale, which had silently disabled the firestore boundary across most of `src/` and the
  `domain/` purity rules entirely, while `npm run lint` reported a clean tree. Found only because
  the guard was tested in both directions with negative controls. Fixed; each scope now declares its
  complete rule set. This is ticket 09's structural guard, landed at step 0 instead of step 5.
- **Overseer findings 3, 4, 5 and 7 have self-closed** since it wrote them (05 finished its edit,
  the feature files landed, the logbook got committed). Finding 1, sequence drift, is answered by
  this entry. Finding 6, ticket 11's scope, is still Badrish's and is flagged to him again.

**Open:**
- **Blocked on Badrish, and it is the only thing blocking step 0:** connect the GitHub repo to the
  `note-maker-f41` Cloudflare Pages project, and set the four `VITE_FIREBASE_*` vars plus
  `NODE_VERSION=20` on Production and Preview. Detail on ticket 10.
- **Owed by the Designer, blocking build step 2:** the literal `NoteDoc` / `LocalNote` types, field
  by field. Step 1 (`domain/title.ts`) does not need them and is unblocked now.
- Ticket 11's per-hunk merge UI is the largest surface in the app for an event a two-device setup
  hits rarely; its own ticket offers a pick-a-side variant at a tenth of the cost. Builder ranks it
  below "running" and would take the cheap variant for v1 — Badrish's call, not his.
- **Corners cut, stated:** the PWA icons are valid but placeholder art (real ones are UI/UX's at
  step 6), and `firestore.rules` does not exist yet so `npm run rules:deploy` would fail today —
  rules land at step 5 with their emulator tests written first.
- Frontier after step 0: **step 1** (`domain/title.ts`), then 02's pure units. Tickets 06, 11, 12,
  13 all sit after the app runs.

**Badrish:** *"Service-worker mode — to be prompt."* · *"We can have 'Push now' and auto push. Just
rename to 'Sync Now' and auto sync."* · *"30 day trash purge can be ticketed properly as
suggested."* And to UI/UX, as a standing instruction now in force: build-team agents take simple
questions to their lead (Builder or Designer) rather than to him, and the lead pushes the answer
into the artifacts rather than leaving it in a transcript.

## 2026-08-25 — session close: 02/03/05 closed, architecture drafted, org stood up
**Worked:** claude, mathematician, designer, ui-ux, builder, overseer
**Moved:**
- This session opened as a `wayfinder` session scoped to ticket 02 and ran well past that scope —
  Badrish named it explicitly on closing. It ends with **02, 03, and 05 all closed**, an application
  architecture drafted and under Builder review at `.scratch/notes-mvp/architecture.md`, and the org
  standing itself up as a working unit for the first time: Designer, Builder, UI/UX, Mathematician
  and Overseer all ran this session, several concurrently, coordinating through the repo rather than
  through Claude.
- **Ticket 02's mechanism carries a same-session amendment**: a manual-send setting (Badrish's
  request) looked like it could widen the snapshot-overwrite guard; the Mathematician traced the
  actual failure, found it lived in one candidate implementation rather than the concept, and fixed
  it by minting `pendingRev` at edit-time unconditionally in both modes — no change to the guard, no
  re-verification needed beyond a schedule-subset argument. Written into 02's ticket as an amendment,
  not a rewrite.
- **Ticket 12 created** (Android back-button), graduated from 05's fog.
- **The Overseer ran an unprompted direction check** with no code yet written — the cheapest possible
  moment for it — and found the thinking sound but the sequence off: ticket 10 (deploy) has sat open
  and unblocked since ticket 04 closed, with nothing shipped. The Builder and the architecture
  converged on the same conclusion independently. Three findings landed on ticket 10: it now owns
  the service-worker update-mode choice (previously unowned), and it carries the deploy-first
  argument.
- **The Builder's readiness pass surfaced three defects the tickets hadn't covered**: ticket 01's
  security rules predate 02's Conflict-copy fields and will reject every one of them; a Conflict
  copy carries two bodies in one document, halving the effective size-cap warning ticket 05 set at
  1 MB; and nothing in the design triggers a retry after a failed push, since network detection was
  deliberately deleted — proposed fix is treating a delivered snapshot as proof of connectivity.
  None of these are fixed yet; they're findings for whoever picks up the architecture next.
- New feature files: `conflict-sync.md`, `sync-engine.md`, `editor-and-shell.md` (superseding the
  provisional one from mid-session), `local-store.md`. New notebooks for builder, designer,
  mathematician, overseer, ui-ux.
- Nothing has been committed since `57e6855`. Everything above is on disk, uncommitted.

**Open — three decisions Badrish is answering in a fresh session:**
1. Service-worker update mode, `autoUpdate` vs `prompt` — Builder recommends `prompt`.
2. The manual-send setting's shape — the Mathematician's fix means Badrish's original request (a
   mode, not a button) is back on the table at no extra cost; Builder's earlier `Push now`-button
   alternative was proposed before that fix existed.
3. Whether the 30-day Trash purge ships in v1 — Builder recommends deferring it to its own ticket.

Also open, not blocking: three questions the Designer put to Badrish in `architecture.md` await the
Builder's or Badrish's answer, and the architecture itself awaits a final pass once those close.

**Badrish:** closed this session on the note that the agent org should work as a unit going
forward, with Claude and himself as a review layer rather than doing the work in parallel — see the
pinned memory. Answers to the three questions above are coming in a new session.

## 2026-08-25 — tickets 03 and 05 resolved by the org
**Worked:** designer, ui-ux, claude
**Moved:**
- **03 closed** by the Designer. Ratified 02's forced conclusion — one own mirror as source of
  truth, Firestore on `memoryLocalCache()` as pure network transport — but **corrected 02's stated
  reason for it**: nothing reads the SDK cache, so the two stores could never visibly disagree. The
  real reasons are a second copy of the corpus on disk, blast radius, and no multi-tab cache
  coordination. Store is `idb`, not Dexie; whole corpus in memory, so **ticket 01's index deferral
  closes with no composite index needed**. Outbox is a column (`pendingRev !== null`), not a table.
  `navigator.storage.persist()` is mandatory. Accepted price: full corpus re-read per app open, with
  the `updatedAt` watermark fix rejected as the clock-skew data-loss trap 02 cut.
- **05 closed** by UI/UX, with a throwaway prototype at
  `.scratch/notes-mvp/prototypes/05-shell/index.html`. The finding that reshaped it: **the app
  cannot honestly say it is offline**, because 02 removed network detection on purpose. Every sync
  affordance is Outbox state about a *Note*, never a network claim. Master-detail shell, markdown as
  source in a textarea with a Write/Read toggle, no explicit save but mandatory flush on `blur`,
  `visibilitychange` and `pagehide`.
- **Ticket 12 created** — Android back-button and history behaviour, graduated from the fog by 05.
  Share-target intent stays in the fog.
- UI/UX was killed mid-task by a usage limit and **resumed with its context intact** rather than
  restarted; only the final writing was lost. Worth knowing that resume works.

**Open:** frontier is **06**, **09**, **10**, **11**, **12**. Designer takes the overall architecture
now that 01–03 are closed; Builder leads implementation after that.
**Badrish:** set the standing rule that the agent team is an organisation that should pick up and
build from the first prompt — he and Claude work the basic plan only, and agents take specifics to
him directly rather than having Claude pre-analyse and hand over a pre-digested brief. **Four
questions are open to him**: sign-out wiping the device, `storage.persist()` returning false,
split-pane preview vs the Write/Read toggle, and whether the `N notes waiting to sync` strip earns
its space.

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
