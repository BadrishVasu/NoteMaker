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
app can be added to an Android homescreen from Chrome. **No installable package is ever produced** —
NoteMaker is a PWA and the map rules out a Play Store app (`map.md`, "PWA, no Play Store", and Out of
scope: "Native Play Store app"). There is no `.apk` to build, sign, or distribute; "install" here is
Chrome's own Add to Home screen acting on the manifest already served by the live host.

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
- [x] Push proposal prepared and pre-flighted, approved, and pushed — `main` is at `c70a301` on both
      local and `origin`. Fast-forward, clean.
- [x] `.gitattributes` added — operations, 2026-08-27, commit `a4e8862`. Forces `text=auto eol=lf`
      repo-wide (one shape-based rule, not a pattern scoped to `.githooks/*` alone — the same
      shape-based-not-judgement-based reasoning already applied to the credential rule), `*.png`
      marked `binary` explicitly. Verified both directions: `git check-attr` on `.githooks/*` and
      representative source/doc files resolves `eol=lf`; the three PNGs resolve `text=unset` via the
      `binary` macro and `git add --renormalize .` on a clean tree left every tracked blob
      byte-identical (no renormalization commit needed — nothing was stored with the wrong ending).
      Also reproduced the actual failure mode live on this machine: `core.autocrlf=true` had already
      drifted `.agents/features/editor-and-shell.md` and
      `.scratch/notes-mvp/issues/04-provision-accounts.md` to CRLF in the working copy despite LF in
      the index; re-checking them out after adding the attributes file produced clean LF, confirming
      `eol=lf` overrides this machine's `core.autocrlf` rather than asserting it should. Not pushed —
      Badrish's word, same as the last push.
- [x] **Local run path documented and its silent failure closed** — builder, 2026-08-27, prompted by
      Badrish asking whether values get hand-edited into `src/platform/firebase.ts` and reverted
      after. They do not: that file reads `import.meta.env` only, so `.env.local` is the entire
      mechanism and no source file is ever touched. Neither ticket 10 nor `.env.example` said this
      anywhere — both described the deployed path only — and both now carry it. Also pinned the dev
      and preview ports (`strictPort`, `vite.config.ts`), because ticket 04's referrer restriction
      lists 5173/4173 explicitly and does not wildcard ports: Vite's default increment past a busy
      5173 produced a 5174 that fails at sign-in with a 403, an auth-shaped error with a port-shaped
      cause. Test written first (`src/test/devServerPorts.test.ts`, 3 cases, red before green), and
      verified in the other direction too — a second `vite` against a running one exits
      `Error: Port 5173 is already in use` instead of taking 5174.
- [x] **Badrish, step 1: connect the GitHub repo to the Pages project** — done 2026-09-01.
- [x] **Badrish, step 2: the five environment variables** — done, and **verified present in the
      deployed bundle** rather than taken from the dashboard showing them. This was the failure worth
      checking: a bundle built without them fails at *sign-in*, not at build time, and reads as an
      auth bug. All four `VITE_FIREBASE_*` values are inlined as real, well-formed literals
      (apiKey matches `AIza[0-9A-Za-z_-]{35}` at 39 chars; authDomain is
      `notemaker-claude.firebaseapp.com`; projectId is the expected slug; appId matches
      `1:<project-number>:web:<hex>`), with no `undefined`, empty-string or placeholder shapes
      anywhere in the bundle and no surviving `import.meta.env` reference. Shape and presence only —
      no value was printed or recorded, per the standing rule.
- [x] **Blank page live on the host** — `https://note-maker-f41.pages.dev/` serves the app, React
      mounts, auth state resolves to the signed-out view. The boot-time `readConfig()` guard does not
      trip, and the console is clean.
- [x] **Sign-in preconditions verified live** — builder, 2026-09-01, via the non-authenticating
      Identity Toolkit `getProjectConfig` call the Firebase SDK itself makes before a popup, issued
      *from the deployed origin*. It returned **HTTP 200**, which is a three-in-one proof: the API
      key is real and enabled (a placeholder returns 400 `API_KEY_INVALID`), the key's HTTP-referrer
      restriction genuinely permits `note-maker-f41.pages.dev` (a blocked referrer returns 403
      `API_KEY_HTTP_REFERRER_BLOCKED`), and the response's `authorizedDomains` list contains
      `note-maker-f41.pages.dev`. Ticket 04's origin split is also live: the auth handler at
      `notemaker-claude.firebaseapp.com/__/auth/handler` serves Firebase's real handler.
- [x] **The `localhost` authorised-domain open question is closed** — it is still on the list, seen
      in the same `authorizedDomains` response. This was recorded as "not verifiable from here" on
      2026-08-27; it is now verified rather than assumed.
- [x] **Service worker registered and `prompt` mode confirmed deployed** — one registration at root
      scope, `sw.js` active and controlling the page, 8 workbox precache entries. `sw.js` is served
      as `application/javascript` and is **not** an SPA HTML fallback, which is the silent way this
      breaks. Confirmed `prompt` and not `autoUpdate` from the deployed artifact itself: no
      unconditional `skipWaiting()`, no `clientsClaim`, and a `SKIP_WAITING` message listener the app
      triggers on accept. Badrish's 2026-08-26 decision is now locked by a real deploy.
- [x] **Installable** — `manifest.webmanifest` served as `application/manifest+json`, `display:
      standalone`, `start_url`/`scope` `/`, and all three icons (192, 512, 512-maskable) return 200
      as real `image/png`. Secure context. Icons remain placeholder art — real ones are UI/UX's at
      step 6.
- [x] **Sign-in completed end to end on the deployed host** — **Badrish, 2026-09-06: done.** Recorded
      with its provenance, the same way the key rotation was on 2026-09-01: this is *Badrish's
      assertion of a click he performed*, not an agent observation. **No agent has seen the uid
      render**, and none can — signing in needs a real Google account, which no agent may
      authenticate. What agents did verify is every precondition (all the boxes above), so the claim
      is consistent with everything measurable from here. An earlier agent attempt returned
      `auth/popup-blocked` from the automation browser — an artifact of that browser, not the deploy;
      worth keeping because the app handled it correctly, rendering the friendly message plus the
      error code.
- [x] **Added to an Android homescreen from Chrome** — **Badrish, 2026-09-16: done**, via Chrome's
      Add to Home screen, and **Google sign-in works inside the installed app too**. Same provenance
      as the sign-in box above: his report of acts on his own device, not an agent observation — no
      agent has seen the installed app or its uid. The second fact matters beyond the first: the
      installed app runs in standalone display mode, where popup-based sign-in is a known place for
      auth flows to break, so this is the origin-split proof repeated in the context the app will
      actually live in. The rest of this box is kept as the record of what the act is.
      Badrish's, because it needs a real device.
      **This is not a packaging step and produces no artifact:** the act is opening
      `https://note-maker-f41.pages.dev/` in Chrome on Android and accepting the install prompt, or
      ⋮ → *Add to Home screen*. Nothing is built, downloaded, signed or sideloaded, and there is no
      `.apk` — see "What it is" above. It is doable today; every installability criterion is verified
      above. Two later tickets genuinely need the installed context rather than a browser tab —
      ticket 03's `navigator.storage.persist()` (a plain tab is often denied where an installed app
      is granted) and ticket 12's back gesture — so this is worth doing before those. The icon will
      be placeholder art until UI/UX's step 6; that is expected, not a bug.
- [x] **Rules actually released to the live project** — builder, 2026-09-17. Badrish signed the
      Firebase CLI in (`npx firebase login:list` → `badrishv2002@gmail.com`), and the deploy ran
      immediately after, gated on green tests (715 unit in 14 files, 72 emulator in 4 files):
      `npx firebase deploy --only firestore:rules --project notemaker-claude --non-interactive`.
      The CLI compiled `firestore.rules` without errors and reported `released rules firestore.rules
      to cloud.firestore` on `notemaker-claude`. `--project` was passed explicitly because there is
      still no `.firebaserc`; `--only firestore:rules` kept the deploy to rules alone — no hosting,
      no functions, no indexes. This closes the follow-up that has been open since Day 6, when the
      same deploy was blocked solely on there being no authorised account on this machine.
- [ ] **The `prompt` update bar has not been exercised**, and could not be by this deploy. A waiting
      service worker only exists once a *second* build is deployed, so the update-available bar first
      becomes testable on the next deploy. Flagged so it is checked then rather than assumed.

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
- `.gitattributes` uses one repo-wide `* text=auto eol=lf` rather than scoping the forced-LF rule to
  `.githooks/*`/`*.sh` — operations — 2026-08-27. A pattern scoped to "the paths that need it today"
  is exactly the shape the ESLint boundary rule and the pre-commit app-id gap both failed in: it's
  provably correct for what it's tested against and silently wrong for the next file that needed it
  and wasn't on the list. One universal rule is one thing to verify, not N patterns to keep in sync
  with what's added later.
- **The Firebase apiKey exposure is closed: rotated and the old key retired** — confirmed by
  Badrish, 2026-09-01. This is his assertion, not a console check performed by any agent — no agent
  has verified the old key's deleted/restricted status directly in the Google Cloud console. Kept for
  the record: established 2026-09-01, the key inlined in the live bundle is **not** the key sitting in
  public git history at `3a8bdaa` — compared by SHA-256 prefix (deployed `8fbc08a5…` vs historical
  `f4b4336a…`), so neither value had to be handled to reach that finding — which was the evidence that
  a new key had been minted. A direct probe of the old key was blocked by the permission classifier,
  correctly, and was not worked around. Badrish's 2026-09-01 confirmation supplies the half that
  actually ends the exposure: the old key is not just superseded but deleted or fully restricted. See
  ticket 04.

## Open questions
None open as of 2026-09-16. Note this does not mean the feature is finished: one item in `State` is
still unchecked — exercising the `prompt` update bar, which cannot happen until a deploy changes what
the service worker precaches. It is **not** Badrish-only: an agent can observe a waiting worker from a
browser. Every Badrish-owned act on step 0 is done (sign-in closed 2026-09-06, the Android install
and in-app sign-in 2026-09-16, both on his word). Status stays `in-progress` for that one box.
