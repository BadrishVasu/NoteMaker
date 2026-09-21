// src/platform/auth.ts — with platform/firebase.ts, the only importer of firebase/auth (ESLint).
//
// Ticket 08: gate the UI on auth STATE, never on tokens. Firebase keeps the refresh token in
// IndexedDB and reports the stored user on an offline cold start; `getIdToken()` rejects after
// ~1h offline, so nothing here exposes it. Sign-in is a popup: `signInWithRedirect` is broken on
// Chrome M115+ for our `*.pages.dev` + `*.firebaseapp.com` origin split. `signOut()` makes no
// network request and succeeds offline.

import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import type { Auth } from 'firebase/auth'
import { getFirebaseAuth } from './firebase'

/** What the app knows about the signed-in user. Deliberately no token. */
export interface AuthUser {
  uid: string
  email: string | null
}

export interface AuthPort {
  /** Fires with the current state as soon as Firebase knows it, then on every change. */
  subscribe(listener: (user: AuthUser | null) => void): () => void
  /** Rejects when the popup can't complete (offline, closed, blocked) — SignIn shows it. */
  signIn(): Promise<void>
  signOut(): Promise<void>
}

export function createFirebaseAuth(auth: () => Auth = getFirebaseAuth): AuthPort {
  return {
    subscribe(listener) {
      return onAuthStateChanged(auth(), (user) => listener(user === null ? null : { uid: user.uid, email: user.email }))
    },
    async signIn() {
      await signInWithPopup(auth(), new GoogleAuthProvider())
    },
    async signOut() {
      await signOut(auth())
    },
  }
}
