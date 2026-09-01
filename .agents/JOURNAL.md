# NoteMaker — journal

Newest entry first. Append only.

## 2026-09-01 — the app is live and verified; ticket 10 closes
**Worked:** builder, operations

**Moved:**
- **The deploy is real and it works.** Badrish finished the Cloudflare Pages setup; we verified it
  rather than assuming it. `https://note-maker-f41.pages.dev/` serves the app, React mounts, auth
  state resolves to the signed-out view, console clean. Ticket 10 is done and
  `features/deploy-pipeline.md` reflects it.
- **The env vars reached the build — checked, not assumed.** This was the one worth the effort: a
  bundle built without them fails at *sign-in*, not at build time, and reads as an auth bug. All four
  `VITE_FIREBASE_*` values are inlined as real, well-formed literals, no `undefined`/empty/placeholder
  shapes, no surviving `import.meta.env`. Shape and presence only; no value printed or recorded.
- **Sign-in's preconditions are verified live, which nothing had ever proved.** Used the
  non-authenticating Identity Toolkit `getProjectConfig` call the Firebase SDK itself makes before a
  popup, issued from the deployed origin. **HTTP 200 is a three-in-one proof**: the key is real and
  enabled (a placeholder returns 400 `API_KEY_INVALID`), the referrer restriction genuinely permits
  this origin (a blocked referrer returns 403 `API_KEY_HTTP_REFERRER_BLOCKED`), and the response's
  `authorizedDomains` contains `note-maker-f41.pages.dev`. The auth handler on the other side of
  ticket 04's origin split is live too.
- **Closed the `localhost` authorised-domain question** left open on 2026-08-27 as "not verifiable
  from here" — it is on the list, seen in that same response. Verified, no longer assumed.
- **`prompt` service-worker mode confirmed from the deployed artifact**, not from the config that was
  supposed to produce it: registered at root scope, active and controlling, 8 precache entries, and
  crucially **no unconditional `skipWaiting()` and no `clientsClaim`** with a `SKIP_WAITING` message
  listener instead. That is `prompt`, not `autoUpdate`. `sw.js` is served as `application/javascript`
  and is **not** the SPA HTML fallback — the silent way this breaks. Badrish's 2026-08-26 decision is
  now locked by a real deploy.
- **The key was rotated — determined without handling either value.** The key in the live bundle is
  *not* the one in public git history at `3a8bdaa`; compared by SHA-256 prefix (`8fbc08a5…` vs
  `f4b4336a…`). **This does not prove the old key was disabled**, which is the half that actually ends
  the exposure. A direct probe of the old key was blocked by the permission classifier, correctly, and
  was not worked around. One console look for Badrish; it is on the feature file's open questions.
- **Operations verified the deploy independently and agreed**, reaching it by a different route
  (asset diffing and header/content-type checks rather than my Identity Toolkit probe). Its tie to the
  commit is the strong one: `manifest.webmanifest`, the CSS, both workbox chunks and all three PNGs
  are **byte-identical** between a fresh local build at `47fb198` and the deployed assets, and those
  are all env-independent. `index.html` differs on exactly one line — the JS `src` hash — which is the
  *correct* outcome, since env values are inlined into the JS and its local build used placeholders.
  It also ran a real **negative control** on the env check: rebuilt with all four vars unset and
  confirmed the script then reports all four absent. That check has teeth in both directions.
- **Operations self-reported a mistake and I'm carrying it up rather than absorbing it.** While
  working out how Vite inlines `import.meta.env`, it printed ~800 chars of its *local* built JS,
  putting the `.env.local` **placeholder** values into its own transcript. Not the real deployed
  credentials, and **nothing credential-shaped reached its committed notebook** — I checked the file
  directly and ran the pre-commit guard over the staged tree (exit 0). The right call was to write the
  diagnostic blind before looking at raw content, real or fake, and it logged that as a dead end.
- **Fixed a cold-start flake in the import-boundary suite, found by accident.** The verification run
  came back **11/12**, not the 12/12 I'd recorded — the first `eslint.lintText` call resolves the flat
  config and loads typescript-eslint from disk, and cold (straight after Operations' `npm ci`) that
  one call alone blew vitest's 5s per-test budget. Warm, the same suite passes in 1.2s. It would have
  hit any fresh clone or CI runner, and it fails **as though the import boundary were broken** — a
  false alarm on the one guard ticket 02's proof rests on, and the tempting response to a flaky guard
  is to skip it. Fixed at the cause: a `beforeAll` primes the config load with its own budget, so each
  test keeps a tight default that still means something. Per-test times went from a >5s timeout to
  3–13ms. Suite 12/12, lint and typecheck clean.
- **Fixed an unlogged regression in the working tree before anything else.** `10-deploy-pipeline.md`
  was sitting modified with 68 deletions and 1 insertion: a stale buffer had dropped both the
  local-run-path section added in `47fb198` and Operations' push-proposal audit trail, adding only a
  trailing space. Restored from HEAD. Nothing of value was in that diff.

**Open:**
- **Badrish's, and the last two things ticket 10 wanted:** click `Sign in with Google` on the live
  host once, and install it to the Android homescreen. Both need a real Google account and a real
  device, so no agent can do either. Every precondition is verified, so these are one click and one
  install, not investigations. An agent attempt hit `auth/popup-blocked` — an artifact of the
  automation browser, not the deploy; the app handled it correctly.
- **Badrish's:** confirm the *old* API key is deleted or fully restricted (Google Cloud console →
  APIs & Services → Credentials). A new key is deployed; retiring the old one is what ends it.
- **The `prompt` update bar has never been exercised** and could not be by a first deploy — a waiting
  worker only exists once a *second* build ships. Check it on the next deploy rather than assuming.
- **Next ticket is build step 1: `domain/title.ts`** — the project's first failing test, pure, no
  infrastructure. It needs nothing from anyone; ticket 01's title-resolution rules (the latch, the
  three-case resolution, `Untitled Note N`) are fully specified and are the test cases.
- **Step 2 is still blocked on the Designer's literal `NoteDoc`/`LocalNote` types**, unchanged across
  four sessions. Worth starting the Designer on those *while* step 1 runs, so step 2 isn't blocked the
  moment step 1 lands.
- Minor, from Operations, neither urgent nor ticket 10's problem: hashed `/assets/*` get
  `max-age=0, must-revalidate` like everything else (an unclaimed cache win, not a bug — ETags keep it
  correct), and Pages returns its SPA fallback rather than a 404 for a missing hashed asset.
- Loose end I am naming rather than hiding: I tried a byte-length cross-check of local vs deployed JS
  (290956 vs 290950) against the env value lengths and **it did not reconcile to the byte**. I am not
  treating it as evidence in either direction — minification and the local Node 24 vs deployed Node 20
  toolchain both confound it, and Operations' byte-identical env-independent assets settle the tie
  properly. Recorded so nobody re-derives it thinking it means something.

**Badrish:** "The cloudflare page is setup. Confirm if everything is OK and then we can move on to
next ticket in new session."

## 2026-08-27 — the local run path, which nothing had ever written down
**Worked:** builder

**Moved:**
- **Badrish asked how to run it locally**, describing the method as: paste values into the `const` in
  `firebase.ts`, `npm run dev`, revert afterwards. Answered from the code: `src/platform/firebase.ts`
  reads `import.meta.env` and holds no literal to edit, so `.env.local` is the whole mechanism and no
  source file is ever touched. The method he described is the one that produced the exposure sitting
  in this repo's history — but the more useful finding is **why he'd reach for it: nothing told him
  otherwise.** Ticket 10 and `.env.example` both documented the *deployed* path only. Local running
  was known by everyone who'd built it and written down by nobody.
- **Pinned the dev/preview ports** — `server`/`preview` `strictPort: true` in `vite.config.ts`.
  Ticket 04's referrer restriction lists `localhost:5173` and `localhost:4173` explicitly and port
  wildcards are not honoured, so Vite's default increment past a busy 5173 silently produces a 5174
  that fails at sign-in with `403 Requests from referer ... are blocked` — an auth-shaped error with
  a port-shaped cause, which is exactly the class Badrish has said reads to him as a bug.
- **Test first, and verified in both directions** — `src/test/devServerPorts.test.ts`, 3 cases, red
  (3/3) before the config change, green after. Then the negative control on the real behaviour, not
  the config object: a second `vite` against a running one now exits `Error: Port 5173 is already in
  use` rather than taking 5174. Two false starts getting there — a squatter on a wildcard address
  and one on `127.0.0.1` both failed to collide, because Vite binds `::1` on this machine. Worth
  remembering: **on Windows, occupying `127.0.0.1:<port>` does not prove a port is occupied.**
  Suite 12/12, lint and typecheck clean.
- **Found `.env.local` already on this machine holding placeholder values**, per its own header. It
  boots — `readConfig()` only throws on *missing* names, not invalid ones — and fails at the sign-in
  popup with `auth/api-key-not-valid`. That is the single most likely thing he hits, so it leads the
  failure table now on ticket 10.
- Empirically checked rather than assumed: dev server serves on 5173, `virtual:pwa-register` resolves
  in dev (a broken import there would be a blank white page, not an error).

**Open:**
- Unchanged and all still Badrish's: connect the Pages project; set the four `VITE_FIREBASE_*` vars
  plus `NODE_VERSION=20` on Production and Preview before the first build; key rotation at the
  Firebase console.
- **Not verifiable from here:** whether `localhost` is still on Firebase Auth's authorised-domains
  list. It is there by default and ticket 04 only ever recorded an *addition*, so almost certainly
  fine — but it is a one-look check in the console, and the failure (`auth/unauthorized-domain`)
  is on ticket 10's table so it isn't mistaken for a code bug.
- Four files modified, nothing committed, nothing pushed.
- Unchanged: the Designer owes the literal `NoteDoc`/`LocalNote` types (blocks step 2); ticket 11's
  per-hunk merge UI scope is Badrish's call; step 1 (`domain/title.ts`) needs nothing from anyone.

**Badrish:** "I would like to run this project on my local machine and see how it works."

## 2026-08-27 — the push landed; `.gitattributes` closes a silent-guard-failure hole
**Worked:** builder, operations

**Moved:**
- **The push went through** — `5da2840..c70a301`, fast-forward. `origin/main` now carries the full
  application tree and is clean of both apiKey- and appId-shaped strings at the tip.
- **`.gitattributes` added by Operations** (`a4e8862`, plus `04297d2` for the logbook, deliberately
  split). `* text=auto eol=lf` repo-wide, `*.png binary`. The target was `.githooks/pre-commit`: a
  CRLF shell script silently stops running, and **a secret guard that stops running looks identical
  to a guard with nothing to report** — the exact failure that made two agent definition files in
  `~/.claude/agents/` unspawnable yesterday without anyone noticing.
- **Operations found the failure mode already live rather than hypothetical.** `core.autocrlf=true`
  had already drifted two tracked files to CRLF working copies despite LF in the index
  (`.agents/features/editor-and-shell.md`, `.scratch/notes-mvp/issues/04-provision-accounts.md`).
  `.githooks/pre-commit` hadn't drifted yet; nothing was stopping it. It then deleted and
  re-checked-out the drifted pair to prove `eol=lf` actually overrides `core.autocrlf` on this
  machine, rather than citing git's docs saying it should.
- **Verified in both directions, which is now four for four on this project.** Positive:
  `.githooks/*` and representative source/doc files resolve `text=auto eol=lf`. Negative: the PNGs.
  Operations noticed `check-attr` still echoes `eol: lf` for binaries cosmetically (the `binary`
  macro doesn't clear that attribute) — so the attribute table alone would have been a false
  negative control — and proved inertness on the actual bytes instead: `git add --renormalize .`
  on the clean tree staged nothing but `.gitattributes` itself, `git hash-object` on `icon-192.png`
  identical before and after. **No blob changed, so no renormalisation commit was owed** — checked,
  not assumed.
- I re-derived it independently: `git ls-files --eol` gives `attr/-text` on the PNG, a stronger
  negative control than the `check-attr` table; hook suite re-run post-change is 11/11.
- **Took the repo-wide rule over scoping to `.githooks/*`/`*.sh`, and it's the right call** — a
  pattern scoped to the paths that need it *today* is the same shape as the ESLint boundary that
  matched nothing and the pre-commit app-id gap: provably correct against what it was tested on,
  silently wrong for the next file nobody added to the list.
- **Corrected Operations' notebook, not its work.** Its new session entry closed with a paragraph
  describing checks belonging to the *previous* session (merge-base ancestry, hook pass rate,
  staged-diff pre-flight) — none of it in this brief. An entry describing verification that didn't
  happen this session is the same failure as a guard that silently matches nothing: it reads as
  evidence to the next agent. Sent it back to fix in its own words.

**Open:**
- **Badrish: two commits sit local and unpushed** (`a4e8862`, `04297d2`); `origin/main` is at
  `c70a301`. Operations held the no-push line, correctly. His word releases them.
- Then unchanged: connect the Pages project, set the four `VITE_FIREBASE_*` vars plus
  `NODE_VERSION=20` on Production and Preview. The first build must not run before the vars are set.
- Key rotation at the Firebase console remains Badrish's and remains open.
- Unchanged: the Designer owes the literal `NoteDoc`/`LocalNote` types (blocks step 2); ticket 11's
  per-hunk merge UI scope is Badrish's call; step 1 (`domain/title.ts`) needs nothing from anyone.
- Still outstanding from last session: whether key rotation constrains push ordering in either
  direction. It does not gate anything currently in front of Badrish.

**Badrish:** "Builder please tell Operations to add the .gitattributes for LF"

## 2026-08-27 — Operations takes the push; a one-word proposal is in front of Badrish
**Worked:** builder, operations

**Moved:**
- **Badrish asked for the Operations agent to own the push, and it does now.** Summoned with one
  hard constraint: prepare and propose, never execute. `git push` runs on Badrish's word and on
  nobody else's. Operations held that line and says so itself in its proposal.
- **Operations re-derived the whole push state independently rather than trusting the Builder's
  summary**, which is the reason to hand this to a second agent at all. Everything checked out —
  9 commits fast-forward (`5da2840` → `cd682b2`, confirmed by `git push --dry-run`), `3a8bdaa`
  confirmed already an ancestor of the public `origin/main`, the 7 uncommitted files run through
  `.githooks/pre-commit` **against their real staged content** rather than only via the test suite
  (exit 0), the 11-case suite clean, a full-tree grep for both credential shapes at zero hits, and
  no stray untracked files outside the known set. It then restored the tree to exactly its
  pre-verification state — nothing staged, nothing committed. Verified that myself.
- **The proposal is commit-then-push, not push alone, and that distinction is the whole point.**
  A bare `git push` would publish the 9 commits and leave the `appId` redaction sitting
  uncommitted — so the corrected tree would *not* be what lands on the public repo. The single
  most important property of this push is the one a naive push would miss.
- **Operations bundled the commit inside the green light rather than gating it separately**, and
  asked me to confirm or split it. Confirmed. The commit is local and reversible; the push is the
  one-way public action, and Badrish asked for something approvable in one word. Making him
  approve a no-risk step twice is worse.
- Ticket 10 gains a `Push proposal` section that is an **audit trail, not a second copy** of the
  proposal — the proposal itself lives in Operations' own words to Badrish. Two copies of the same
  thing drift, and the copy nobody trusts is worse than none.

**Open:**
- **Badrish: the green light.** One word runs commit-then-push. Then unchanged: connect the Pages
  project, set the four `VITE_FIREBASE_*` vars plus `NODE_VERSION=20` on Production and Preview.
  The first build must not run before the vars are set.
- **Asked Operations one question it hadn't answered: does the key rotation constrain push
  ordering in either direction?** It stayed out of the rotation's ownership, correctly, but that
  wasn't the question — sequence was. Answer outstanding; it does not change what Badrish is
  approving, since rotation is not part of the proposal.
- Rotation itself is with Badrish and Claude, and Operations was told not to duplicate it.
- Unchanged: the Designer owes the literal `NoteDoc`/`LocalNote` types (blocks step 2); ticket 11's
  per-hunk merge UI scope is Badrish's call; step 1 (`domain/title.ts`) needs nothing from anyone.

**Badrish:** "Builder please trigger the operations agent for pushing commits to GitHub repo so
that I may give it the green light."

## 2026-08-27 — the unpushed tree, and a second miss in the same redaction
**Worked:** builder

**Moved:**
- **Answered Badrish on why `origin/main` is nine commits behind: it is a gap, not a decision.** The
  push was never on ticket 10's list of things only he can do, so nobody was holding it. Ticket 10's
  Badrish-actions list is corrected and now runs **push → connect Pages → set env vars**, with the
  reason spelled out: Pages builds from GitHub, and `origin/main` (`5da2840`) contains no
  application code, so connecting first would have deployed an empty tree and produced a fake deploy
  failure.
- **Assessed the tree as safe to publish, and the assessment found something.** Ticket 04 still
  recorded the literal Firebase `appId`. The earlier redaction kept it on the reasoning that it is
  "a name rather than a key" — the same conflation Badrish already corrected once, in a smaller
  costume, and a direct contradiction of ticket 10's own rule that none of the four
  `VITE_FIREBASE_*` values belong in the repo. Redacted to a pointer. **The rule is now
  shape-based, not judgement-based.**
- **The pre-commit guard had the matching hole and it is closed, test-first.** Added a Firebase
  app-id pattern; wrote the failing test before the pattern, with a negative control (colon-separated
  prose that must still commit). `.githooks/test-pre-commit.sh` is 11 cases, all passing.
- **Found and recorded a real exposure that nothing was tracking:** the apiKey commit `3a8bdaa` was
  pushed to the **public** `origin/main` on 2026-08-25, and the redaction (`662360f`) never was — so
  the literal key is in the file at the public tip right now. Pushing *cleans* the tip. Only
  rotation at the Firebase console ends it, and that is Badrish's. Written onto ticket 04 and into
  `features/deploy-pipeline.md`'s open questions.

**Open:**
- **Badrish, in order:** push `main`; connect the GitHub repo to the `note-maker-f41` Pages project;
  set the four `VITE_FIREBASE_*` vars plus `NODE_VERSION=20` on Production and Preview. The first
  build must not run before the vars are set — a bundle built without them fails at sign-in, not at
  build time, and reads as an auth bug.
- **Badrish, separately:** whether to rotate the exposed apiKey. Not urgent (Firestore rules and
  Google sign-in are the real guard) but it is the only thing that ends the exposure.
- Unchanged from 2026-08-26: the Designer owes the literal `NoteDoc`/`LocalNote` types (blocks step
  2); ticket 11's per-hunk merge UI scope is still Badrish's call; step 1 (`domain/title.ts`) is
  unblocked and needs nothing from anyone.

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
