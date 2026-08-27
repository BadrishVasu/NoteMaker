# Provision Firebase project and Cloudflare Pages account

Type: task (HITL)
Status: resolved

## Question

Nothing here is a decision — this is manual work only Badrish can do, and every deployment ticket
waits on it. Claude cannot create accounts or enter credentials.

Checklist:

1. Create a Google Cloud / Firebase project for NoteMaker at console.firebase.google.com.
2. Enable **Cloud Firestore** in the project, in production mode (rules come from ticket 01).
3. Enable **Authentication** and turn on the **Google** sign-in provider.
4. Register a **Web app** in the project and copy the Firebase config object (apiKey, authDomain,
   projectId, appId, and so on).
5. Create a Cloudflare account and a **Cloudflare Pages** project; note the assigned `*.pages.dev`
   hostname.
6. Add that hostname to Firebase Auth's **Authorised domains** list, or Google sign-in will be
   rejected in production.

## Answer

### Provisioned

| Fact | Value |
|---|---|
| Firebase project id | `notemaker-claude` |
| Firestore edition | **Standard** (not Enterprise) — correct for this build |
| Auth domain | `notemaker-claude.firebaseapp.com` |
| Cloudflare Pages URL | `https://note-maker-f41.pages.dev/` |

### Firebase web config

These values are **public by design** — Firebase web config ships inside the client bundle and
cannot be hidden from anyone running the app. Security comes from Firestore rules (ticket 01) and
Auth authorised domains, not from keeping these values secret.

**That is not the same as publishing them.** "Cannot be hidden from a user of the app" and "belongs
in a public Git repository" are different claims, and an earlier revision of this ticket conflated
them. This repo is public and `.scratch/` is committed on purpose, so a value pasted here is a value
indexed by every credential scanner pointed at GitHub.

**The line is drawn by shape, not by whether the value is really a secret** — corrected a second
time, 2026-08-27. The first correction removed the `apiKey` and kept the rest on the reasoning that
they "are names rather than keys". That reasoning is the same conflation in a smaller costume: the
`appId` is not a name, it is an opaque generated identifier that looks exactly like a credential, and
ticket 10 already says **none of the four `VITE_FIREBASE_*` values belong in this repo**. Recording
one of them here contradicted that ticket outright. Judging value-by-value whether something is
"really" sensitive is precisely where the first mistake came from, so the rule is mechanical:
anything carried into the build as a `VITE_FIREBASE_*` variable is a pointer here, never a value.

What stays below are plain names — a hostname and a project slug, both of which already appear in
`.firebaserc` and in the deploy target by necessity, and neither of which is credential-shaped.

```
apiKey              <not recorded — VITE_FIREBASE_API_KEY, see "Where the values live" below>
authDomain          notemaker-claude.firebaseapp.com
projectId           notemaker-claude
appId               <not recorded — VITE_FIREBASE_APP_ID, see "Where the values live" below>
```

`storageBucket`, `messagingSenderId` and `measurementId` are gone from this list as well as from the
build: ticket 10 omits the first two deliberately (no Cloud Storage, no FCM) and there is no
Analytics in this product. An unused config field is a thing a future contributor wires something to.

### The apiKey is already published, and rotation is Badrish's call

Recorded 2026-08-27 so it is not rediscovered. The commit that first pasted the key, `3a8bdaa`, was
**pushed to the public `origin/main` on 2026-08-25**. The redaction commit `662360f` was not, so as
of today the file at the public tip *still contains the literal key*, and the working tree in this
clone is the only place it is redacted.

Two consequences:

- **Pushing does not make this worse — it makes the tip clean.** The key is already indexed. The
  first push removes it from the current file; it stays in `3a8bdaa` in history regardless.
- **History rewriting is not the remedy and is not the Builder's to perform.** A force-push does not
  retract a value a scanner has already read, and GitHub retains unreachable commits.
  **Rotation at the Firebase console is the only real fix, and it is Badrish's.** Rotating means
  minting a replacement web API key, re-applying the referrer restriction from step 4 below, and
  updating `VITE_FIREBASE_API_KEY` in Cloudflare Pages and in `.env.local`. It is not urgent in the
  sense of a leaked secret — Firestore rules and Google sign-in are what actually guard the notes,
  and the referrer restriction caps quota abuse — but it is the one action that ends the exposure.

### Where the values live

Firebase console → Project settings → General → Your apps → Web app → SDK setup and configuration.
Ticket 10 supplies all four to the build as `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
`VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_APP_ID`, set as Cloudflare Pages environment variables
and in a local `.env.local` (gitignored). Nothing in the repo holds a literal `apiKey` or `appId`,
and `.githooks/pre-commit` refuses any commit that reintroduces either — it now carries a pattern
for the app-id shape as well as the `AIzaSy` shape, with negative controls in
`.githooks/test-pre-commit.sh`.

### Referrer restriction is a quota guard, not an auth boundary

Worth stating plainly, because the restriction verified below reads as stronger than it is: the
`Referer` header is set by the caller, so any non-browser client can spoof an allowed origin and be
served. A `curl` request carrying `Referer: https://note-maker-f41.pages.dev/` returns `200` — the
verification procedure below is itself the proof. What the restriction actually buys is that a
scraped key cannot be pointed at this project's Identity Toolkit quota by a bot sending no `Referer`
at all, which is the overwhelming majority of them.

What stands between a scraped `apiKey` and the notes themselves is Firestore rules (ticket 01) plus
Google sign-in. That was always the design; this note only removes the temptation to read the
referrer list as a second lock.

### Facts later tickets depend on

1. **`signInWithPopup` is mandatory, not preferred.** The app origin (`note-maker-f41.pages.dev`)
   and the auth domain (`notemaker-claude.firebaseapp.com`) are different sites, which is precisely
   the topology research ticket 08 found `signInWithRedirect` to be broken on since Chrome M115.
   This is now confirmed by the provisioned values rather than merely anticipated.
2. **Analytics removed.** ✅ Done by Badrish. The console's generated snippet calls
   `getAnalytics(app)`; Analytics is not in scope, adds a dependency and cookie-consent surface to
   an offline-first app, and does nothing for a single-user notes tool. `measurementId` stays in the
   recorded config above for completeness, but nothing initialises Analytics. Ticket 10 must not
   reintroduce it when scaffolding the app.
3. **`storageBucket` goes unused.** File attachments are out of scope; no Storage rules need
   writing or hardening.
4. **Restrict the API key — and include the auth domain.** Public by design does not mean
   unrestricted: the key should carry an HTTP-referrer restriction in the Google Cloud console so it
   cannot be used to drive Identity Toolkit quota from elsewhere.

   **The referrer list must include `notemaker-claude.firebaseapp.com`.** `signInWithPopup` opens a
   handler page at `https://notemaker-claude.firebaseapp.com/__/auth/handler`, and that page calls
   Identity Toolkit with this same key. Restricting to only the app origin and localhost blocks the
   key's own auth handler and sign-in fails with `Requests from referer <domain> are blocked`
   (firebase-js-sdk#5657). An earlier revision of this item omitted this and was wrong.

   Required entries:

   ```
   https://note-maker-f41.pages.dev/*
   https://notemaker-claude.firebaseapp.com/*     <- without this, sign-in breaks
   http://localhost:5173/*                        <- Vite dev default; add other ports as used
   ```

   If ticket 10 enables Cloudflare Pages **preview deployments**, those get generated subdomains
   (`<hash>.note-maker-f41.pages.dev`) which the entries above do not cover. Either add
   `https://*.note-maker-f41.pages.dev/*` or accept that sign-in only works on production.

   If **API restrictions** (as opposed to application restrictions) are ever also applied to this
   key, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`, and
   `firestore.googleapis.com` must all remain allowed.

   Not blocking; worth doing before the app is in daily use.

### Checklist status

All six steps confirmed done by Badrish. The two that fail *silently in production while working
locally* were verified explicitly rather than assumed:

- **Step 3** — Google sign-in provider enabled under Authentication. ✅
- **Step 6** — `note-maker-f41.pages.dev` added to Firebase Auth's **Authorised domains**. ✅

Ticket 10 can deploy against this project without a further provisioning round.

### Verifying the API key restriction without an app

The referrer check happens at Google's edge, so it can be exercised with a plain HTTP call long
before any app exists — no deploy and no dev server needed. Probe the Identity Toolkit config
endpoint with a spoofed `Referer`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Referer: https://note-maker-f41.pages.dev/" \
  "https://identitytoolkit.googleapis.com/v1/projects?key=$FIREBASE_API_KEY"
```

`200` means allowed, `403` with `Requests from referer <origin> are blocked` means it is not on the
list. Verified on 2026-08-25: production origin, preview subdomain, auth handler, and
`localhost:5173` all returned 200; an unlisted origin and a request with **no** `Referer` both
returned 403. Re-verified 2026-08-26 with the same result. Note the limit of that claim: it shows
the key is unusable by a client that sends no `Referer`, not that it is unusable by non-browser
clients in general — see "Referrer restriction is a quota guard" above.

**Ports must be listed explicitly** — port wildcards are not reliably honoured. Both Vite ports are
needed:

- `http://localhost:5173/*` — dev server
- `http://localhost:4173/*` — **preview server**, which is the one that matters for PWA work, since
  service workers do not activate in the dev server. Omitting it makes the first local PWA test fail
  with a 403 that looks like a service-worker bug rather than a key restriction.

**Read the status code carefully — 400 is not 403.**

| Code | Meaning |
|---|---|
| `200` | Origin is on the Website restrictions list. |
| `403` | Origin is genuinely blocked. `Requests from referer <origin> are blocked`. |
| `400` | `API key not valid` — **the key never reached the referrer check**. Says nothing at all about the restriction. |

A malformed key returns `400` for *every* origin. Any script that treats "not 200" as "blocked"
will then report a tidy column of blocked results, including for the negative-control origin, and a
completely unverified key looks secure. Assert against the expected code per origin instead of
testing for `-ne 200`.

Common cause on Windows: interpolating the key into a **single-quoted** PowerShell string, which
sends the literal text `$key` as the API key.
