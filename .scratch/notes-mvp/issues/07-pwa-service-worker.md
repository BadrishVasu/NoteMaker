# PWA service-worker strategy, precache set, and Android install

Type: research (AFK)
Status: resolved

## Question

What does `vite-plugin-pwa` actually give us, and what must we configure ourselves?

Research and report: the caching strategy options and which suits an App shell whose data comes
from Firestore rather than the network; exactly what belongs in the precache manifest; how a new
version of the app reaches an already-installed PWA and whether the user must be prompted to
reload; the current state of the Android install prompt (`beforeinstallprompt`), what a manifest
must contain for Chrome on Android to consider the app installable, and which icon sizes are
required; and any known interaction between a service worker and the Firestore SDK's own IndexedDB
use.

Resolve with the `research` skill; capture findings as a file and link it here.

## Answer

`generateSW` with **no** `runtimeCaching` is the right fit: Firestore keeps its offline data in
IndexedDB, not Cache Storage, so the service worker's only job is the app shell. Defaults already
precache Vite's hashed `js/css/html` plus manifest icons; keep Firebase endpoints, large media, and
anything over Workbox's 2 MiB cap out. Updates install into a *waiting* SW — `prompt` needs
`updateSW()`, `autoUpdate` sets `skipWaiting`+`clientsClaim` but **still** needs
`registerSW({ immediate: true })` to actually reload the tab, and the docs warn that switching
`autoUpdate` → `prompt` after deploy is problematic, so pick before first deploy. Android install
needs HTTPS + linked manifest + `name`/`short_name`, `start_url`, `display: standalone`, and 192 +
512 icons; add a 512 `maskable` (40% safe zone) or Android renders a white-backed icon. Chrome no
longer requires a service worker to install (Android 108+), but `beforeinstallprompt` — still
non-standard, Chromium-only — does. No SW/Firestore conflict, but Firestore persistence **cannot
run inside a worker scope at all**, which rules out background sync; also
`enableIndexedDbPersistence()` is deprecated in favour of `localCache: persistentLocalCache(...)`.

Detail with citations: [`research/07-pwa-service-worker.md`](../research/07-pwa-service-worker.md)
