# Firebase Auth offline behaviour (web / PWA)

Ticket: [08-auth-offline-behaviour](../issues/08-auth-offline-behaviour.md)
Researched: 2026-08-25 · Sources: Firebase docs + `firebase-js-sdk` source (v10/v11 `master`)

**Bottom line: the offline-first premise holds.** A signed-in session survives cold starts with no
network indefinitely, `onAuthStateChanged` still reports the user, and the Firestore cache stays
fully readable and writable. The only thing that breaks offline is *server sync* — which is
expected. One real caveat (`getIdToken()` rejects) and one design consequence (sign-out must be
handled locally) are called out below.

---

## 1. How the session is persisted, and how long it survives

**Default persistence for browsers is a hierarchy, IndexedDB first:**

```ts
persistence: [
  indexedDBLocalPersistence,
  browserLocalPersistence,     // localStorage
  browserSessionPersistence    // sessionStorage
]
```
— `packages/auth/src/platform_browser/index.ts`
(https://github.com/firebase/firebase-js-sdk/blob/master/packages/auth/src/platform_browser/index.ts)

The three documented persistence modes:

| Mode | Meaning (quoted from docs) | Storage |
|---|---|---|
| `local` | "the state will be persisted even when the browser window is closed" | IndexedDB, falling back to `localStorage` |
| `session` | "will only persist in the current session or tab, and will be cleared when the tab or window ... is closed" | `sessionStorage` |
| `none` | "will only be stored in memory and will be cleared when the window or activity is refreshed" | in-memory |

Web default is `local`; "An explicit sign out is needed to clear that state."
— https://firebase.google.com/docs/auth/web/auth-state-persistence

**Durability with no network contact: effectively unlimited.** What is persisted is the *refresh
token*, not the ID token. Refresh tokens "expire only when one of the following occurs: The user is
deleted, The user is disabled, A major account change is detected for the user."
— https://firebase.google.com/docs/auth/admin/manage-sessions

None of those can happen on an offline device, so nothing local expires the session. Sessions are
only lost by an explicit `signOut()`, by the user clearing site data, or by browser storage
eviction of the origin's IndexedDB.

> PWA note: an installed PWA's storage is the same origin storage; Chrome/Android may evict data
> under storage pressure for non-persistent origins. Requesting
> [`navigator.storage.persist()`](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)
> protects both the auth session and the Firestore cache from eviction. Installed PWAs are among
> the cases where Chrome auto-grants persistence, but it is worth requesting explicitly.

## 2. What happens when the ID token expires offline

ID tokens "are short lived and last for an hour"
(https://firebase.google.com/docs/auth/admin/manage-sessions). The SDK treats a token as expired
30 s early (`Buffer.TOKEN_REFRESH = 30_000`) and proactively refreshes 5 min before expiry
(`Duration.OFFSET = 5 * 1000 * 60`).

**`onAuthStateChanged` still reports the user: yes. `currentUser` stays populated: yes.** This is
explicit in the cold-start path — a failed `reload()` is tolerated *only* for network errors, and
the stored user is kept:

```ts
try {
  await _reloadWithoutSaving(user);
} catch (e) {
  if ((e as FirebaseError)?.code !== `auth/${AuthErrorCode.NETWORK_REQUEST_FAILED}`) {
    // Something's wrong with the user's token. Log them out
    return this.directlySetCurrentUser(null);
  }
}
return this.directlySetCurrentUser(user);
```
— `packages/auth/src/core/auth/auth_impl.ts` (`initializeCurrentUser` /
`reloadAndSetCurrentUserOrClear`)
(https://github.com/firebase/firebase-js-sdk/blob/master/packages/auth/src/core/auth/auth_impl.ts)

That is the decisive line: **offline cold start keeps you signed in; a genuinely bad/revoked token
signs you out.**

The background refresher agrees — it retries network failures with exponential backoff
(30 s doubling to a 16 min cap) and never signs the user out:

```ts
if ((e as FirebaseError)?.code === 'auth/NETWORK_REQUEST_FAILED') {
  this.schedule(/* wasError */ true);
}
```
— `packages/auth/src/core/user/proactive_refresh.ts`
(https://github.com/firebase/firebase-js-sdk/blob/master/packages/auth/src/core/user/proactive_refresh.ts)

**`getIdToken()` does fail.** `StsTokenManager.getToken()` returns the cached access token only if
it is not expired; otherwise it must hit the STS endpoint, and a failed refresh propagates
uncaught — there is no retry or fallback in that class:

```ts
if (!this.isExpired && !forceRefresh) { return this.accessToken; }
_assert(this.refreshToken, auth, AuthErrorCode.TOKEN_EXPIRED);
await this.refresh(auth, this.refreshToken!);
```
— `packages/auth/src/core/user/token_manager.ts`
(https://github.com/firebase/firebase-js-sdk/blob/master/packages/auth/src/core/user/token_manager.ts)

So offline, past the hour mark, `getIdToken()` rejects with `auth/network-request-failed` while
`currentUser` remains valid. **Never gate UI on `getIdToken()`** — gate on `onAuthStateChanged`.
`user.uid` is available from the persisted record without any network call, which is all the app
needs to scope Firestore paths.

## 3. Does the Firestore cache stay readable? — **Yes**

This is the viability question, and the answer is clean.

- Firestore's client starts at `User.UNAUTHENTICATED` and operates before any credential exists;
  credential changes arrive asynchronously through a listener
  (`this.authCredentials.start(asyncQueue, async user => {...})`).
  — `packages/firestore/src/core/firestore_client.ts`
  (https://github.com/firebase/firebase-js-sdk/blob/master/packages/firestore/src/core/firestore_client.ts)
- Tokens are consumed **only by the remote stream**. When `getToken()` rejects, the failure is
  confined to opening the gRPC/WebChannel stream — it is wrapped and routed to `handleStreamClose`,
  which puts the stream into backoff and retries:
  ```ts
  (error: Error) => {
    const rpcError = new FirestoreError(Code.UNKNOWN, 'Fetching auth token failed: ' + error.message);
    return this.handleStreamClose(rpcError);
  }
  ```
  — `packages/firestore/src/remote/persistent_stream.ts`
  (https://github.com/firebase/firebase-js-sdk/blob/master/packages/firestore/src/remote/persistent_stream.ts)
  Nothing in that path touches the local store, so **an unrefreshable token degrades exactly to
  "offline", not to "broken"**.
- Reads are served from cache and writes are queued locally, per the docs: when offline "the SDK
  serves data from local cache"; `SnapshotMetadata.fromCache` distinguishes cached from server
  data; "When the device comes back online, Cloud Firestore synchronizes any local changes ... For
  multiple changes to the same document, it's last write wins."
  — https://firebase.google.com/docs/firestore/manage-data/enable-offline

  (Use `includeMetadataChanges: true` on listeners to observe cache→server transitions.)
- Persistence is **off by default on web** and must be enabled explicitly — on modern SDKs via
  `initializeFirestore(app, { localCache: persistentLocalCache(...) })` (the older
  `enableIndexedDbPersistence()` is deprecated). Default cache size 100 MB, or
  `CACHE_SIZE_UNLIMITED`. Same source as above. **Forgetting this is the actual way to break
  offline-first** — nothing in Auth does it.
- Security rules are enforced by the backend on sync, not against the local cache; the Firestore
  reference explicitly warns not to rely on cache clearing "for secure data removal between user
  sessions" (`clearIndexedDbPersistence` doc comment,
  https://github.com/firebase/firebase-js-sdk/blob/master/packages/firestore/src/api/database.ts).
  Fine for a single-user personal app; worth knowing it is not a security boundary.

## 4. Cold start with no network and no fresh token — what to show

The correct UI gate is `onAuthStateChanged`, and it resolves without the network:

- The callback fires **only after initialization completes** — auth first restores from IndexedDB,
  attempts a `reload()`, tolerates the network failure, and only then notifies subscribers
  (`this._initializationPromise` → `initializeCurrentUser` → `notifyAuthListeners`; subscribers get
  `promise.then(() => cb(this.currentUser))`). So there is a brief indeterminate window on every
  cold start — render a splash/skeleton, not a login screen, until the first callback lands.
  Otherwise the app flashes "signed out" on every launch.
  — `auth_impl.ts`, cited above.
- Then: **`user !== null` → go straight to the notes UI**, served from the Firestore cache. No token
  call, no network probe.
- **`user === null` → genuinely signed out** (or never signed in), because the SDK only nulls the
  user for non-network errors. Show sign-in — and if `navigator.onLine === false`, say "you're
  offline, sign-in needs a connection" rather than presenting a Google button that cannot work.

**Distinguishing "not signed in" from "signed in but unreachable":**

| Signal | Meaning |
|---|---|
| `onAuthStateChanged` → `null` | not signed in — real, trustworthy, offline-safe |
| `onAuthStateChanged` → user, `fromCache === true` on snapshots | signed in, server unreachable |
| `getIdToken()` rejects `auth/network-request-failed` | token stale — **not** a sign-out signal |

Use `SnapshotMetadata.fromCache` (plus `hasPendingWrites`) as the sync indicator, not
`navigator.onLine` — `onLine` reports link state, not reachability
(https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine).

## 5. Sign-out with no network

**`signOut()` makes no network request** — it is purely local: run before-state middleware, clear
any redirect user, then `_updateCurrentUser(null)` → `directlySetCurrentUser(null)` (removes the
user from persistence) → `notifyAuthListeners()`.
— `auth_impl.ts`, cited above. So sign-out **always succeeds offline**; there is no failure mode to
design around. (Corollary: it does not revoke the refresh token server-side. Irrelevant for a
personal single-user app.)

**What happens to the Firestore cache on sign-out:**

- The credential-change listener switches the local store to the new (unauthenticated) user:
  "Tells the LocalStore that the currently authenticated user has changed. In response the local
  store switches the mutation queue to the new user."
- **Mutation queues are per-user** (`this.mutationQueue = this.persistence.getMutationQueue(user, ...)`),
  so pending offline writes are parked, not lost, and resume when the same user signs back in.
- **Cached remote documents are shared across users and are NOT cleared** — `remoteDocuments` is
  assigned once in the constructor and never reassigned on user change.
  — `packages/firestore/src/local/local_store_impl.ts`
  (https://github.com/firebase/firebase-js-sdk/blob/master/packages/firestore/src/local/local_store_impl.ts)

So note content **survives sign-out on disk**. To actually wipe it you must call `terminate()` then
`clearIndexedDbPersistence()` — "Persistence can only be cleared before a Firestore instance is
initialized or after it is terminated", and `terminate()` "does not cancel pending writes"
(https://github.com/firebase/firebase-js-sdk/blob/master/packages/firestore/src/api/database.ts).
Doing so discards queued offline writes, so only clear after confirming nothing is pending — or
simply don't clear, given single-user and a personal device.

## 6. Popup vs redirect, and offline durability

**No bearing on offline durability.** Both flows terminate in the same persisted refresh token in
the same IndexedDB store; nothing about how the session was established affects how it survives.
The choice is purely about whether sign-in works *at all* on Android Chrome.

`signInWithRedirect` relies on "a cross-origin iframe that connects to your app's Firebase Hosting
domain," which browsers now break by blocking third-party storage — required since **Chrome M115+**
(June 24, 2024), and already the case for Firefox 109+ and Safari 16.1+.
— https://firebase.google.com/docs/auth/web/redirect-best-practices

**This bites this project directly: the app is on `*.pages.dev`, and `authDomain` will be the
Firebase-provided `*.firebaseapp.com` — a different origin. That is precisely the broken
configuration.** The doc's fixes are: use a custom domain as `authDomain`, reverse-proxy `/__/auth/`,
self-host the helper code, or **use `signInWithPopup()`**.

**Recommendation: `signInWithPopup()`.** It sidesteps the storage-partitioning problem entirely,
needs no custom domain (which the free-tier `*.pages.dev` plan rules out anyway), and sign-in is a
once-ever event on a personal device. The doc's own caveat — "popups are occasionally blocked by
the device or platform, and the flow is less smooth for mobile users" — is worth knowing, but a
blocked popup is a visible, retryable failure on first run, versus redirect silently failing to
complete on modern Chrome. Trigger it from a direct user gesture (button click) so the popup
blocker allows it.

> Note that popup/redirect choice is not fully this ticket's to decide if it touches the sign-in UX
> ticket; the *fact* recorded here is that redirect is broken on `*.pages.dev` + `*.firebaseapp.com`
> without a proxy, and popup is not.

---

## Risks to the offline-first premise

1. **None fatal.** Auth and Firestore both degrade to "offline", not "broken". The premise holds.
2. **`getIdToken()` is the trap.** Any code path that awaits a token before rendering — a naive auth
   guard, an API helper — turns a working offline app into a hang or a spurious logout after one
   hour offline. Gate on `onAuthStateChanged` only.
3. **Persistence is opt-in on web.** Firestore offline cache is off by default; it must be
   configured at `initializeFirestore`. Cover this with a test.
4. **Storage eviction** is the only realistic way to lose the session on an installed PWA. Call
   `navigator.storage.persist()`.
5. **The initialization gap** on cold start — render a splash until the first `onAuthStateChanged`
   callback, or the app flashes a login screen every launch.
