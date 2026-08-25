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
cannot be hidden. Security comes from Firestore rules (ticket 01) and Auth authorised domains, not
from keeping these secret. Recording them here is therefore safe and is the canonical reference for
ticket 10, which wires them in as `VITE_FIREBASE_*` build variables.

```
apiKey              AIzaSyDxz3-jmljEYe4I_XJ60XCPGqBNt0fuOfw
authDomain          notemaker-claude.firebaseapp.com
projectId           notemaker-claude
storageBucket       notemaker-claude.firebasestorage.app
messagingSenderId   27217454343
appId               1:27217454343:web:d53445fd7173e373cc91a2
measurementId       G-4Z7S3RNJPP
```

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
returned 403, confirming the key is unusable from non-browser clients.

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
