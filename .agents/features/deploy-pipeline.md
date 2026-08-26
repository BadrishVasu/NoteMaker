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
- [ ] **Badrish: connect the GitHub repo to the Pages project, and set the four `VITE_FIREBASE_*`
      vars plus `NODE_VERSION=20` on Production and Preview.** Step 0 is blocked on this and on
      nothing else.
- [ ] Vite + React + TS + Vitest scaffold, ESLint import-boundary rule, PWA manifest and icons
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

## Open questions
- None. Execution is waiting on the two dashboard actions above.
