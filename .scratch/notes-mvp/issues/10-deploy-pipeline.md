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

### Steps only Badrish can perform

Both are in the Cloudflare dashboard, and step 0 is blocked on them:

1. **Connect this GitHub repo to the `note-maker-f41` Pages project** (Workers & Pages → the project
   → Settings → Builds & deployments → connect to Git), with the build settings from the table above
   and production branch `main`.
2. **Set the four `VITE_FIREBASE_*` variables plus `NODE_VERSION=20`** on Production and Preview.
   Values come from the Firebase console: Project settings → General → Your apps → SDK setup and
   configuration. They are not recorded in this repo and must not be pasted into it.

Everything else in this ticket is the Builder's and runs from the repo.
