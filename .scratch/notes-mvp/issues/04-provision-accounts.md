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
4. **Restrict the API key.** Public by design does not mean unrestricted: the key should carry an
   HTTP-referrer restriction in the Google Cloud console limiting it to the `pages.dev` origin and
   localhost, so it cannot be used to drive quota from elsewhere. Not blocking; worth doing before
   the app is in daily use.

### Checklist status

All six steps confirmed done by Badrish. The two that fail *silently in production while working
locally* were verified explicitly rather than assumed:

- **Step 3** — Google sign-in provider enabled under Authentication. ✅
- **Step 6** — `note-maker-f41.pages.dev` added to Firebase Auth's **Authorised domains**. ✅

Ticket 10 can deploy against this project without a further provisioning round.
