# Cloudflare Pages build config and Firebase config as environment variables

Type: task
Status: in-progress — decisions settled 2026-08-26, execution is build step 0
Blocked by: 04

## Question

How does a commit become a live app on the `*.pages.dev` URL?

Settle and then set up: the Cloudflare Pages build command and output directory for a Vite build;
how the Firebase web config reaches the build as environment variables, and which of those values
are safe to expose in a client bundle (most are, but state it explicitly rather than assuming);
whether preview deployments on branches are enabled, and whether they need their own Firebase
project or can share one; and how Firestore security rules get deployed, since Cloudflare Pages
does not deploy them.

**Also settle the service-worker update mode (`autoUpdate` vs `prompt`).** Ticket 07 found this
must be chosen before the first deploy — switching afterward is problematic — and no other ticket
owns the choice. It belongs here because this is the ticket that actually ships the first build;
see `.scratch/notes-mvp/issues/07-pwa-service-worker.md` and `research/07-pwa-service-worker.md`
for the tradeoff.

Depends on ticket 04: there is no project or hostname to configure until the accounts exist.

## Flagged by the Overseer

Nothing has been deployed since ticket 04 closed, despite this ticket being open and unblocked the
whole time. The map's destination is a *running* app, not a specified one — the cheapest de-risking
step available is a Vite hello-world pushed through this exact pipeline: build, deploy to
`note-maker-f41.pages.dev`, install to the Android homescreen, sign in. That proves the referrer
allowlist, `signInWithPopup` across the origin split, and the manifest/icons — three things
currently believed to work on research alone rather than verified.

## Answer

Decided by the `builder` agent, 2026-08-26. **This ticket is now the work in front of the org** — it
is build step 0 in [`architecture.md`](../architecture.md), and nothing else starts before a blank
page is live and a real sign-in has returned a real uid on the real host.

### Sequencing: this ticket runs first, and it carries the auth smoke test with it

The Overseer's flag, the Designer's build order and my own readiness pass converged on this
independently, which is the only reason it needs no further argument. Badrish's `prompt` answer was
the last input this ticket was waiting on.

Step 0 ships **three things and no features**: a Vite hello-world on the live host, a `Sign in with
Google` button that renders the uid and nothing else, and the PWA manifest with icons so the app
installs to the Android homescreen. The auth half is not padding — ticket 04's topology (app origin
`note-maker-f41.pages.dev` vs auth domain `notemaker-claude.firebaseapp.com`, the referrer
allowlist, the auth handler's own key use) is the other thing in this project that works on
localhost and fails only in production. Both risks cost two hours together at zero complexity, or a
week of confusion once there is real code to blame.

### Build configuration

| Setting | Value |
|---|---|
| Framework preset | None (Vite is configured directly) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/` |
| Node version | 20 (`NODE_VERSION=20` env var; Pages defaults are older than Vite 5 wants) |

### Firebase config as environment variables

Four variables, all `VITE_`-prefixed so Vite inlines them:

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_APP_ID
```

`storageBucket` and `messagingSenderId` are **deliberately omitted** — there is no Cloud Storage and
no FCM in this product, and an unused config field is a thing a future contributor wires something
to.

Set them in the Cloudflare Pages dashboard for **both** Production and Preview environments. Locally
they live in `.env.local`, which `.gitignore` already covers. The repo carries `.env.example` holding
**the four names and no values**.

**On "which of these are safe to expose":** all four ship inside the client bundle by necessity — a
web app cannot reach Firebase without them, and no amount of build configuration hides them from
anyone with devtools. That is *not* the same claim as "safe to commit", and this repo is public.
Nothing in the repo holds a literal value; see ticket 04, which was corrected on exactly this point.
The actual enforcement boundary is Firestore security rules plus the Auth authorised-domain list
plus the API-key HTTP-referrer restriction — never secrecy of the key.

### Preview deployments: enabled, and they cannot sign in

Enabled. They cost nothing and they catch a broken build per branch.

**Sign-in will not work on a preview URL, and that is accepted rather than fixed.** Generated
subdomains (`<hash>.note-maker-f41.pages.dev`) are not covered by Firebase Auth's authorised-domain
list, which matches hostnames exactly and does not wildcard. Ticket 04 offered the fork; this is the
branch we take, because the alternative — a `https://*.note-maker-f41.pages.dev/*` referrer entry —
weakens the key restriction across every generated subdomain forever to buy sign-in on throwaway
builds, and Firebase Auth would still refuse the domain regardless. **Previews prove the build.
Production proves auth.** A preview that shows the sign-in screen and fails on click is correct
behaviour, not a bug; anyone who forgets this will spend an afternoon on it, hence this paragraph.

No second Firebase project. One user, one corpus, and a second project would need its own
provisioning, its own rules deploy and its own allowlist for no gain.

### Firestore security rules deployment

Cloudflare Pages does not deploy rules, and rules are the one enforcement point a compromised client
cannot bypass — so they cannot be a thing someone remembers to paste into a console.

**`firestore.rules` lives in the repo at the root.** It is deployed by `npm run rules:deploy`
(`firebase deploy --only firestore:rules`), run by whoever changes the file, and the emulator rules
tests from ticket 01 must pass in CI before that is legitimate.

**Not automated in CI, deliberately.** A GitHub Action would need a `FIREBASE_SERVICE_ACCOUNT`
secret — a real credential Badrish would have to mint and paste — to automate a deploy that happens
perhaps three times in this project's life. That trade is bad today. It becomes good the moment
rules start churning, and at that point it is a ticket, not an improvisation. The guard that
actually matters is the CI test, and that has no secret and is in place from step 5.

### Service-worker update mode: `prompt`

**Settled by Badrish, 2026-08-26**, on the Builder's recommendation. Ticket 07 established this must
be chosen before the first deploy and is problematic to switch afterwards, and no other ticket owned
it — it does now, and it is locked by the deploy this ticket performs.

`vite-plugin-pwa` with `registerType: 'prompt'`. On a waiting service worker, one non-blocking bar
offering a reload; `updateSW()` on accept. Consequences worth stating rather than rediscovering:

- **`autoUpdate` was rejected because this is a text editor.** `skipWaiting` + `clientsClaim` can
  swap the running app out from under a user mid-sentence. The mirror makes that survivable, not
  pleasant — and 05's whole design premise is that the editor never moves under the user's hands.
- **The cost of `prompt` is a user who never reloads runs stale code indefinitely.** Accepted: one
  user, one device class, and the bar is persistent rather than dismissible-forever.
- The reload itself is always safe. Ticket 03's mirror is durable and the Outbox is a stored column,
  so a reload mid-push loses a push attempt, never a keystroke. The bar therefore needs no Outbox
  interlock and must not grow one.
- The affordance's placement and copy are UI/UX's at build step 6. It shares the shell's bottom
  strip region with 05's `N notes waiting to sync`, and the two must not stack.

### Steps only Badrish can perform, in this order

Corrected 2026-08-27: **the push comes first, and it was missing from this list.** Cloudflare Pages
builds from GitHub, and `origin/main` is nine commits behind — it sits at `5da2840`, which predates
every ticket resolution and all of step 0. Connecting the Pages project today would build a tree
with **no application code in it**: no `package.json`, no `index.html`, no `src/`. The build would
either fail outright or deploy an empty directory, and the first thing anyone looked at would be a
deploy failure caused by ordering rather than by anything real.

0. **Push `main` to `origin`.** Nine commits, no rewriting, a plain fast-forward. This is a
   *decision* rather than a formality because the repo is public — see the paragraph below, and the
   exposure note on ticket 04. Badrish's call; the Builder's assessment is that the tree is safe to
   publish.
1. **Connect this GitHub repo to the `note-maker-f41` Pages project** (Workers & Pages → the project
   → Settings → Builds & deployments → connect to Git), with the build settings from the table above
   and production branch `main`.
2. **Set the four `VITE_FIREBASE_*` variables plus `NODE_VERSION=20`** on Production and Preview.
   Values come from the Firebase console: Project settings → General → Your apps → SDK setup and
   configuration. They are not recorded in this repo and must not be pasted into it.

Steps 1 and 2 may be done in either order relative to each other, but **the first build must not run
before step 2** — a build without the env vars produces a bundle whose Firebase config is
`undefined`, which fails at sign-in rather than at build time and looks like an auth bug. If the
connect in step 1 triggers a build immediately, set the variables and redeploy.

### Is the tree safe to publish?

Assessed by the `builder` agent, 2026-08-27, because "push to a public repo" deserves an answer
rather than an assumption.

**Yes — with one correction made first, now landed.** What was checked, and what it found:

- Every tracked file was scanned for credential shapes (Google API keys, tokens, PEM blocks,
  service-account JSON, Firebase app ids). **One hit:** ticket 04 still recorded the literal
  `appId`, which the earlier redaction had kept on the reasoning that it is "a name rather than a
  key". That reasoning was wrong and contradicted this ticket's own rule that none of the four
  `VITE_FIREBASE_*` values belong in the repo. Redacted to a pointer.
- **The pre-commit guard had the matching gap** and has been closed: it now carries a Firebase
  app-id pattern, tested in both directions in `.githooks/test-pre-commit.sh` (11 cases, positive
  and negative controls, all passing). A scanner that never matches is indistinguishable from a
  clean repo, so the negative controls are the part that makes this claim mean anything.
- `.gitignore` covers `.env` and `.env.*` with a single `!.env.example` exception, and
  `.env.example` holds the four names, no values. `.env.example` is the only env file tracked.
- Nothing else in the tree is sensitive: source, config, tickets and the logbook.

**The one thing publishing does not fix** is that the apiKey is *already* public — it went to
`origin/main` in `3a8bdaa` on 2026-08-25 and is still in the file at the public tip. Pushing
improves that (the tip becomes clean); only rotation ends it. See ticket 04.

Everything else in this ticket is the Builder's and runs from the repo.

### Push proposal — Operations, 2026-08-27

Assigned by the Builder to own step 0's push mechanics: prepare the exact commands, pre-flight
everything that can be checked without publishing, and put a one-word-approvable proposal in front
of Badrish. **Operations does not run `git push`; Badrish's word is the only trigger.**

Independently re-verified rather than trusted from the Builder's summary:

- `main` is 9 commits ahead of `origin/main` (`5da2840`); `git push --dry-run origin main` reports
  a clean fast-forward to `cd682b2` — no rejection, no divergence.
- `3a8bdaa` (the literal apiKey commit) confirmed an ancestor of `origin/main` via
  `git merge-base --is-ancestor` — the exposure is real and pre-existing, not created by this push.
- The 7 uncommitted files staged and run through `.githooks/pre-commit` directly against their real
  staged content (not just the test suite): hook exits 0, nothing credential-shaped. The 11-case
  test suite also re-run clean.
- Full-tree grep for the apiKey and app-id regexes across every tracked file: zero hits.
- No untracked files sitting outside the known 7 — the uncommitted set is exactly what the Builder
  described, nothing missed.

Two of the 7 files are Operations' own edits to this ticket and to `features/deploy-pipeline.md`,
made in the course of this assessment — they ride in the same commit as the other 5, no new file
added to the set except this notebook entry's sibling, `.agents/notes/operations.md`.

The full proposal (commands, wording, what ships) is in the `**To Badrish —**` block Operations
addressed to him directly. It is not duplicated here; this section is the audit trail for the
verification behind it.
