# Feature: Deploy pipeline and first running app
Status: in-progress
Owner: builder
Tickets: [10 · Cloudflare Pages build config and Firebase env vars](../../.scratch/notes-mvp/issues/10-deploy-pipeline.md),
[04 · Provisioning](../../.scratch/notes-mvp/issues/04-provision-accounts.md),
[07 · PWA service worker](../../.scratch/notes-mvp/issues/07-pwa-service-worker.md)

## What it is
The path from a commit to a live, installable app on `https://note-maker-f41.pages.dev/`. This is
build step 0 in `architecture.md` and it is the first thing in the project that produces something a
person can actually open. It carries three proofs and no features: the pipeline builds and deploys,
a real Google sign-in returns a real uid on the real host across ticket 04's origin split, and the
app installs to an Android homescreen.

## State
- [x] Firebase project, Cloudflare Pages hostname, auth provider and authorised domains provisioned
      (ticket 04, verified)
- [x] Build command, output dir, Node version, env-var names decided — ticket 10
- [x] Preview deployments: **enabled, and they cannot sign in.** Accepted, not a bug. Firebase Auth
      matches authorised domains exactly and does not wildcard generated preview subdomains.
- [x] Rules deploy: `firestore.rules` in the repo, `npm run rules:deploy` by hand, gated on the
      emulator tests. Deliberately not automated — automating it needs a service-account secret to
      save three deploys over the project's life.
- [x] Service-worker update mode: **`prompt`** — Badrish, 2026-08-26. Locked by the first deploy.
- [x] Vite + React + TS + Vitest scaffold, ESLint import-boundary rule, PWA manifest and icons —
      built and verified locally (tests, lint, typecheck, production build, browser mount). Commit
      `cd682b2`.
- [x] Tree assessed as safe to publish — builder, 2026-08-27. Full-tree credential scan; the one
      hit (a literal `appId` still recorded on ticket 04) is redacted, and the pre-commit guard now
      carries an app-id pattern with negative controls. See ticket 10.
- [ ] **Badrish, step 0: push `main` to `origin`.** Nine commits, fast-forward. Cloudflare Pages
      builds from GitHub and `origin/main` (`5da2840`) predates all application code, so connecting
      the Pages project before this builds an empty tree.
- [x] Push proposal prepared and pre-flighted — operations, 2026-08-27. Exact commit + push commands
      in front of Badrish for one-word approval. Independently re-verified: fast-forward dry-run
      clean, hook fires 0 on the real staged content, zero credential-shaped matches tree-wide.
      Operations does not execute the push; see ticket 10.
- [ ] **Badrish, step 1: connect the GitHub repo to the Pages project.**
- [ ] **Badrish, step 2: set the four `VITE_FIREBASE_*` vars plus `NODE_VERSION=20` on Production
      and Preview.** The first build must not run before this — a bundle built without them fails at
      sign-in, not at build time, and reads as an auth bug.
- [ ] Blank page live on the host
- [ ] Sign-in smoke test passing on the deployed host (not localhost)
- [ ] Installed to an Android homescreen

## Decisions
- Deploy runs **before any feature work**, and carries the auth smoke test with it — builder,
  concurring with the Overseer's sequence finding and the Designer's build order — 2026-08-26
- Service-worker update mode `prompt`; `autoUpdate` rejected because it can swap a text editor out
  mid-sentence — Badrish — 2026-08-26
- One Firebase project, no separate preview project — builder — 2026-08-26
- `storageBucket` and `messagingSenderId` omitted from the config: no Storage, no FCM, and an unused
  config field is something a future contributor wires to — builder — 2026-08-26
- No credential values in the repo; `.env.example` carries names only — standing rule, ticket 04
- The rule is **shape-based, not judgement-based**: anything carried as a `VITE_FIREBASE_*` variable
  is a pointer in the repo, never a value. Deciding value-by-value whether something is "really"
  sensitive is what let the `appId` through the first redaction — builder — 2026-08-27
- The push to `origin` is deploy step 0, ahead of both dashboard actions — builder — 2026-08-27

## Open questions
- **The Firebase apiKey is already on the public `origin/main`** (`3a8bdaa`, 2026-08-25) and is
  still in the file at the public tip. Pushing cleans the tip; only rotation at the Firebase console
  ends the exposure, and that is Badrish's to do. Not urgent — Firestore rules and Google sign-in
  are the actual guard — but open. Waiting on Badrish. See ticket 04.
