# Firebase Auth offline: session persistence and token expiry with no signal

Type: research (AFK)
Status: resolved

## Question

Offline-first is worthless if opening the app on a plane logs you out.

Research and report: how Firebase Auth persists a session in the browser and how long it survives
without contacting the network; what happens when the ID token expires while offline and whether
the SDK can still serve a cached identity; whether Firestore's offline cache remains readable in
that state or whether reads start failing; what the app should show on a cold start with no network
and no fresh token; and how signing out is handled when the sign-out itself cannot reach the
server.

Resolve with the `research` skill; capture findings as a file and link it here.

## Answer

**Offline-first holds.** Firebase Auth persists the *refresh* token in IndexedDB (default `local`
persistence); refresh tokens expire only on user deletion/disable/major account change, so an
offline session lasts indefinitely. On cold start with no network the SDK explicitly keeps the
stored user — it only signs out on non-network errors — so `onAuthStateChanged` reports the user and
`currentUser` stays populated. `getIdToken()` *does* reject after ~1h offline; never gate UI on it.
Firestore's cache is unaffected: tokens are used only by the remote stream, so a failed refresh
degrades to "offline", not "broken" — cached reads and queued writes keep working. `signOut()` makes
no network request and always succeeds offline, but cached documents are NOT cleared on sign-out
(mutation queues are per-user; the document cache is shared).

**Flagged:** `signInWithRedirect` is broken on Chrome M115+ for our `*.pages.dev` +
`*.firebaseapp.com` origin split — use `signInWithPopup()`. Firestore offline persistence is
opt-in on web and must be configured at `initializeFirestore`.

Detail: [research/08-auth-offline-behaviour.md](../research/08-auth-offline-behaviour.md)
