# Research: PWA service-worker strategy, precache set, and Android install

Ticket: [`issues/07-pwa-service-worker.md`](../issues/07-pwa-service-worker.md)
Date: 2026-08-25
Sources: vite-plugin-pwa docs, Chrome/Workbox docs, web.dev, MDN, Firebase docs and the
`firebase-js-sdk` reference in the SDK repo. Every claim below carries the URL it came from.

---

## 1. What `vite-plugin-pwa` offers, and what suits this app

### Strategy vs behaviour — two independent axes

The plugin separates *how the service worker is produced* (`strategies`) from *how it behaves in
the browser* (`registerType`).
<https://vite-pwa-org.netlify.app/guide/service-worker-strategies-and-behaviors.html>

**Strategies (`strategies` option):**

- `generateSW` (default) — Workbox generates the whole service worker from config. No SW code is
  written by hand.
- `injectManifest` — you write the service worker source yourself; the plugin compiles it and
  injects the precache manifest into it via `self.__WB_MANIFEST`.

<https://vite-pwa-org.netlify.app/guide/service-worker-strategies-and-behaviors.html>

**Behaviours (`registerType` option):**

- `prompt` (default) — the user is told an update is available and chooses when to apply it.
- `autoUpdate` — the new service worker takes over as soon as it is available.

<https://vite-pwa-org.netlify.app/guide/service-worker-strategies-and-behaviors.html>

### What the plugin generates for you

Three artefacts: the web app manifest (injected into the entry point), the service worker itself
(built with `workbox-build`), and a registration script.
<https://vite-pwa-org.netlify.app/guide/>

### Which suits an app shell whose data comes from the Firestore SDK

Fact relevant to the choice: with `generateSW` and no `runtimeCaching` entries configured, the
generated service worker only does **precaching** — cache-first serving of the built assets listed
in the manifest — plus a navigation fallback. Workbox precaching is described as "cache-first,
serves precached responses unless unavailable."
<https://developer.chrome.com/docs/workbox/modules/workbox-precaching>

Firestore's own offline story is entirely separate from the service worker: the SDK persists to
IndexedDB, not to the Cache Storage API (see §5). So there is no data-caching work for the service
worker to do here — the SW's only job is to make the *app shell* (JS/CSS/HTML/icons) available
offline. That is exactly the default `generateSW` job with zero `runtimeCaching`.

`injectManifest` becomes necessary only when custom SW code is wanted — e.g. push handlers, a
`share_target` POST handler, background sync. None of those are in this MVP's scope per the map.
<https://vite-pwa-org.netlify.app/guide/service-worker-strategies-and-behaviors.html>

**Flag / surprise:** the docs are explicit that switching from `autoUpdate` to `prompt` *after
deployment* is problematic and should be decided before shipping: "Before deployment, verify this
behavior suits your use case, as switching from `autoUpdate` to `prompt` later can be problematic."
<https://vite-pwa-org.netlify.app/guide/auto-update.html> — this is a decision that must be made
before the first real install, not deferred.

---

## 2. What belongs in the precache manifest for a Vite SPA — and what must not

### Included by default

- `globPatterns` defaults to `**/*.{js,css,html}` over the build output directory.
  <https://vite-pwa-org.netlify.app/guide/static-assets.html>
- Icons referenced from the PWA web app manifest that live in Vite's `publicDir` are added
  automatically, unless `includeManifestIcons: false`.
  <https://vite-pwa-org.netlify.app/guide/static-assets.html>
- The plugin sets `globDirectory` to the build output root, `navigateFallback: 'index.html'`,
  `cleanupOutdatedCaches: true`, a `dontCacheBustURLsMatching` regex derived from Vite's
  `assetsDir`, and `offlineGoogleAnalytics: false`.
  <https://github.com/vite-pwa/vite-plugin-pwa/blob/main/src/options.ts>

### Adding to it

- `includeAssets` — resolves globs inside `publicDir` for things the default patterns miss:
  favicons, SVGs, fonts. Example from the docs: `includeAssets: ['fonts/*.ttf', 'images/*.png']`.
- `workbox.globPatterns` — for assets outside `publicDir`. **Caveat straight from the docs:** if
  you override `globPatterns` you own it completely; omitting `css`, `js` or `html` will cause
  service worker errors.

<https://vite-pwa-org.netlify.app/guide/static-assets.html>

### Revisioning — why the hashed Vite output is a good fit

Workbox precaching versions entries two ways: URLs that already carry a content hash in the
filename (`app.0c9a31.css` — which is exactly what Vite emits for JS/CSS) are used as cache keys
unmodified with `revision: null`; URLs without versioning (notably `index.html`) get a content-hash
query parameter appended.
<https://developer.chrome.com/docs/workbox/modules/workbox-precaching>

This is why `dontCacheBustURLsMatching` is pre-set to Vite's `assetsDir` — hashed assets must not
be double-busted.
<https://github.com/vite-pwa/vite-plugin-pwa/blob/main/src/options.ts>

### What must NOT be precached

Workbox's own guidance lists what to keep out of the precache: **large media files, third-party
content, and frequently-changing data**.
<https://developer.chrome.com/docs/workbox/modules/workbox-precaching>

Applied here, concretely:

- **Firestore / Firebase endpoints.** Cross-origin (`firestore.googleapis.com`,
  `identitytoolkit.googleapis.com`) and dynamic — never precache, and don't add runtime caching for
  them either (see §5).
- **Sourcemaps** — the plugin derives sourcemap handling from Vite's build settings rather than
  precaching them blindly. <https://github.com/vite-pwa/vite-plugin-pwa/blob/main/src/options.ts>
- **Anything above `maximumFileSizeToCacheInBytes`** (Workbox default 2 MiB) will be silently
  dropped from the manifest with a build warning; a large bundled markdown editor could hit this.
  <https://developer.chrome.com/docs/workbox/modules/workbox-build/>
- **The Firebase Auth handler path**, if `signInWithRedirect` is ever used — the navigation
  fallback would otherwise swallow it. `workbox.navigateFallbackDenylist` (an array of RegExp) is
  the escape hatch for excluding URLs from the SPA navigation fallback.
  <https://vite-pwa-org.netlify.app/workbox/generate-sw.html>
  Note this is a *navigation* fallback only — it does not affect XHR/`fetch` calls the Firestore
  SDK makes, so it is a narrow concern.

---

## 3. How a new version reaches an already-installed PWA

### The lifecycle

The browser checks for an updated service worker automatically on navigations within the SW's
scope. A newly-installed SW enters **waiting** and does not take control while the old one still
has clients; it activates only when all old clients go away. `registration.update()` can force a
check.
<https://developer.chrome.com/docs/workbox/service-worker-lifecycle/>

**This is the crux for an installed Android PWA:** a standalone PWA window is often never fully
closed — it is backgrounded. So without `skipWaiting`, an update can sit in the waiting state
essentially indefinitely.

### `prompt` (plugin default)

You wire `registerSW` with two callbacks; `onNeedRefresh` is where you render "new version
available — reload", and calling `updateSW()` applies the update and reloads the page.
`onOfflineReady` fires when the app is first fully cached.

```ts
import { registerSW } from 'virtual:pwa-register'
const updateSW = registerSW({ onNeedRefresh() {}, onOfflineReady() {} })
```

<https://vite-pwa-org.netlify.app/guide/prompt-for-update.html>

### `autoUpdate`

Setting `registerType: 'autoUpdate'` makes the plugin set `workbox.clientsClaim = true` and
`workbox.skipWaiting = true` automatically.
<https://vite-pwa-org.netlify.app/guide/auto-update.html> and confirmed in
<https://github.com/vite-pwa/vite-plugin-pwa/blob/main/src/options.ts>

**Non-obvious:** "autoUpdate" does not by itself reload the tab. The docs state you must add
`registerSW({ immediate: true })` in the app entry point for the page to actually refresh and show
the new content; without it the caches update but the open tab keeps running the old code.
<https://vite-pwa-org.netlify.app/guide/auto-update.html>

**Documented downside:** "the user can lose data in any browser windows/tabs in which the
application is open and is filling in a form" — the docs explicitly recommend `prompt` for apps
with forms. A notes editor is a form-shaped app.
<https://vite-pwa-org.netlify.app/guide/auto-update.html>

### The `skipWaiting` / `clientsClaim` tradeoff

- `skipWaiting()` skips the waiting phase so the new SW activates immediately.
- `clientsClaim()` makes the activated SW take control of already-open pages.
- The cost, per Chrome's own docs: "The old service worker may have handled fetches during page
  startup, but the new service worker then takes control later on. This can break stuff like
  lazily-loaded subresources until the next navigation request."
  <https://developer.chrome.com/docs/workbox/service-worker-lifecycle/>

That version-skew risk is real for a Vite SPA, because Vite emits hash-named lazy chunks; a page
loaded from version N that requests a chunk after version N+1's SW has claimed it and purged the
old precache will 404 on that chunk. The mitigation is the same in both modes: whenever the new SW
takes over, the page should be reloaded rather than left running old code — which `prompt` +
`updateSW()` and `autoUpdate` + `immediate: true` both do.

**Answer to "must the user be prompted to reload?"** No, not technically — `autoUpdate` +
`immediate: true` reloads without asking. But an unasked reload can discard in-flight editor state.
Both modes are viable; the choice is a product call, and per §1 it should be made before first
deploy.

---

## 4. Chrome-on-Android installability, today

### Manifest requirements (Chromium)

- `name` **or** `short_name`
- `icons` including **a 192px and a 512px icon**
- `start_url`
- `display` (and/or `display_override`) — one of `fullscreen`, `standalone`, `minimal-ui`, or
  `window-controls-overlay`
- `prefer_related_applications` absent or `false`

<https://web.dev/articles/install-criteria> ·
<https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable>

The manifest must be linked from the document head: `<link rel="manifest" href="manifest.json">`.
<https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable>

### Transport

Served over **HTTPS** (or `localhost` / `127.0.0.1` for local dev). Cloudflare Pages gives HTTPS on
`*.pages.dev` by default, so this is satisfied.
<https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable>

### Service worker — the requirement has changed

**This is the biggest thing that has moved and is worth flagging.** Chrome **removed** the
requirement for a service worker with a `fetch` handler in order to install from the menu — Android
Chrome 108+ and desktop Chrome 112+. Chrome now supplies a default offline page for sites without
one. MDN concurs: "While not a requirement for a PWA to be installable, many PWAs use service
workers to provide an offline experience."
<https://developer.chrome.com/blog/update-install-criteria> ·
<https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable>

**But** — the same Chrome post says the *prompt* algorithm (i.e. `beforeinstallprompt` firing)
"still requires the presence of a `fetch()` handler" while Chrome works on new signals. So a custom
in-app install button still needs the service worker. `vite-plugin-pwa` produces one regardless, so
this is satisfied in practice; it just means "menu install works without a SW, custom install
button does not."
<https://developer.chrome.com/blog/update-install-criteria>

### Engagement heuristics

Chrome additionally applies engagement heuristics before offering install: the user must have
interacted with the page (tap/click, possibly on a previous visit) and spent at least ~30 seconds
viewing it. Also, the app must not already be installed.
<https://web.dev/articles/install-criteria>

web.dev also notes installability checks "can take several seconds," so `beforeinstallprompt` will
not fire immediately on load.
<https://web.dev/learn/pwa/installation>

### Icons

- Required sizes: **192×192 and 512×512** (see above).
- `purpose` values: `any` (default), `maskable`, `monochrome`; multiple values are allowed
  space-separated, e.g. `"purpose": "maskable any"`.
  <https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons>
- **Maskable icons are not required, but are strongly recommended for Android.** Without one, PWA
  icons on Android 8.0+ render with a white background inside the adaptive-icon shape. The safe
  zone rule: the logo must sit within a centred circle of radius equal to 40% of the icon width.
  <https://web.dev/articles/maskable-icon>
- Chrome DevTools → Application → Manifest has a "show only the minimum safe area for maskable
  icons" toggle to verify this, and shows an **Installability** section listing any errors.
  <https://developer.chrome.com/docs/devtools/progressive-web-apps/>

Practical minimum icon set for this app: `192×192` (`purpose: any`), `512×512` (`purpose: any`),
plus a separate `512×512` with `purpose: maskable` designed to the 40% safe zone. Using one file
with `"purpose": "any maskable"` is possible but produces a padded-looking icon in `any` contexts.

### `beforeinstallprompt` — current state

- **Non-standard and experimental**, MDN classifies it as "Limited availability — not Baseline";
  Chromium-only (Chrome, Edge, Samsung Internet, Opera). Not in Firefox or Safari.
  <https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent>
- Usage pattern: listen for the event, call `event.preventDefault()` to suppress Chrome's own
  install UI, stash the event, and later call `event.prompt()` **from a user gesture**; the result
  (or `event.userChoice`) resolves to an object with an `outcome`.
  <https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent>
- It is still supported and is still the way to drive a custom install button;
  <https://developer.chrome.com/blog/update-install-criteria> confirms it remains the mechanism for
  controlling when the install prompt appears.

**Practical note for a single-user app:** since only Badrish installs it, and Chrome's own menu
("Add to Home screen" / "Install app") already works once the manifest criteria are met, a custom
`beforeinstallprompt` button is optional convenience, not a requirement for the destination.

---

## 5. Service worker ↔ Firestore IndexedDB persistence

### They are separate systems and do not fight

Firestore's offline cache is stored in **IndexedDB**; a service worker's precache lives in the
**Cache Storage API**. Different storage backends, no shared keys, no overlap. Firebase's own
`firebase-talk` guidance states plainly that Firestore's cache is IndexedDB-based and does not use
a service worker, and that Workbox "won't have any interaction with Firestore."
<https://groups.google.com/g/firebase-talk/c/DoMa6XGciPE> ·
<https://firebase.google.com/docs/firestore/manage-data/enable-offline>

**Corollary:** do not attempt to add Workbox `runtimeCaching` for `firestore.googleapis.com`.
Firestore transport is a long-lived WebChannel/streaming connection, not cacheable request/response
pairs, and caching it would at best waste storage and at worst break realtime listeners. Workbox's
own "don't precache third-party content / frequently-changing data" guidance covers this.
<https://developer.chrome.com/docs/workbox/modules/workbox-precaching>

### Current API — the older one is deprecated

The Firebase JS SDK reference carries an explicit deprecation on the old calls:

> "This function will be removed in a future major release. Instead, set
> `FirestoreSettings.localCache` to an instance of `PersistentLocalCache`"

— applied to both `enableIndexedDbPersistence()` and `enableMultiTabIndexedDbPersistence()`.
<https://github.com/firebase/firebase-js-sdk/blob/master/docs-devsite/firestore_.md>

The current form is `initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: … }) })`
with either `persistentSingleTabManager()` (no cross-tab sync, the default) or
`persistentMultipleTabManager()` (synchronises queries and mutations across tabs).
`persistentLocalCache()` is IndexedDB-backed and cannot be used in Node.
<https://github.com/firebase/firebase-js-sdk/blob/master/docs-devsite/firestore_.md>

**Flag:** a lot of tutorial material still shows `enableIndexedDbPersistence()`. Ticket 02 / the
build should use the `localCache` form.

### Real constraints worth knowing

1. **Firestore persistence does not work inside a service worker or web worker.** The SDK's
   persistence path touches `localStorage`, which is unavailable in worker scopes, and fails there.
   <https://github.com/firebase/firebase-js-sdk/issues/6962> ·
   <https://github.com/firebase/firebase-js-sdk/issues/7364>
   Consequence: no Firestore access from inside `sw.js`. Background sync of notes via the service
   worker is not an option — this app's sync must happen in the page. For this MVP that is fine
   (Firestore's own queue handles offline writes while the page is open), but it is a genuine
   architectural limit worth recording.
2. **Persistence is browser-limited** — Firebase documents support for Chrome, Safari and Firefox
   only. <https://firebase.google.com/docs/firestore/manage-data/enable-offline>
3. **Cache size** defaults to a 100 MB threshold before Firestore garbage-collects older unused
   documents; configurable via `cacheSizeBytes`, minimum 1 MB, or `CACHE_SIZE_UNLIMITED`.
   <https://firebase.google.com/docs/firestore/manage-data/enable-offline>
4. **Historical, and closed:** a 2019 Workbox issue reported a service worker update being delayed
   by exactly 60 seconds when Firestore was in play. It is closed and was against Workbox 5 alpha /
   Firebase 6.x. Not expected to recur, but it is the one documented case of the two systems
   interfering, so if update-application ever feels stuck for ~60s, this is the precedent.
   <https://github.com/GoogleChrome/workbox/issues/2192>
5. **Firebase Auth + service workers.** Firebase documents a service-worker session pattern and
   notes service workers only intercept *same-origin* requests — which it frames as a CSRF defence.
   Firebase Auth's own endpoints are cross-origin, so a same-origin SPA service worker never sees
   them. <https://firebase.google.com/docs/auth/web/service-worker-sessions>
   (Relevant only if `signInWithRedirect` is used, whose handler lives on the `authDomain` — also
   cross-origin. Ticket 03's territory, noted here only so the SW config doesn't get blamed later.)

---

## Summary of facts, compressed

| Question | Answer |
|---|---|
| Strategy | `generateSW` covers this app; `injectManifest` only needed for custom SW code (push, share target, background sync) — all out of MVP scope |
| Runtime caching | None needed. Firestore data lives in IndexedDB, not Cache Storage. Do not runtime-cache Firebase endpoints |
| Precache set | Vite's hashed `js/css/html` + `index.html` + manifest icons. Defaults already do this |
| Excluded | Firebase/Google endpoints, large media, files >2 MiB (Workbox default cap), sourcemaps |
| Update delivery | New SW installs and waits; `prompt` needs `updateSW()`, `autoUpdate` sets `skipWaiting`+`clientsClaim` but still needs `registerSW({ immediate: true })` to actually reload |
| Prompt required? | No, but `autoUpdate` can discard unsaved editor state; docs recommend `prompt` for form-bearing apps |
| Install requirements | HTTPS, linked manifest, `name`/`short_name`, `start_url`, `display: standalone`, icons 192 + 512, no `prefer_related_applications: true` |
| Icons | 192 + 512 `any`, plus a 512 `maskable` with a 40%-radius safe zone for Android |
| SW required to install? | No (Chrome 108 Android / 112 desktop), but `beforeinstallprompt` still requires a fetch handler |
| Firestore ↔ SW | Independent storage; no conflict. But Firestore persistence cannot run inside a worker scope at all |

## Things that surprised me / worth escalating

1. **`autoUpdate` does not reload the page on its own.** The name strongly implies it does. Missing
   `registerSW({ immediate: true })` produces an app that silently updates its caches but keeps
   serving old code in the open window — the exact failure mode that is hardest to notice on a
   daily-driver PWA.
2. **The `autoUpdate` → `prompt` switch is documented as problematic after deployment.** This makes
   the choice a pre-first-deploy decision, not something to defer.
3. **Firestore persistence cannot run in a service worker.** Rules out any background-sync design
   for notes. Sync only happens while the app is open.
4. **`enableIndexedDbPersistence()` is deprecated** in favour of `localCache: persistentLocalCache(...)`
   at `initializeFirestore` time — most tutorials are stale on this.
5. **Chrome dropped the service-worker install requirement**, but kept it for `beforeinstallprompt`.
   Harmless here, but a common source of stale advice.
