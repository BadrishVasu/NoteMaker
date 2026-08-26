import { useEffect, useState } from 'react'
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import { getFirebaseAuth } from '../platform/firebase'

/**
 * Build step 0 — this is the whole app, and it is deliberately not a feature.
 *
 * It exists to prove three things on the *deployed* host that research alone cannot prove:
 * the pipeline builds and deploys, `signInWithPopup` works across ticket 04's origin split
 * (`note-maker-f41.pages.dev` app origin vs `notemaker-claude.firebaseapp.com` auth domain, with
 * the API key restricted by HTTP referrer), and the manifest installs to an Android homescreen.
 *
 * Ticket 08: the UI gates on auth state, never on tokens. `getIdToken()` is never called here,
 * because it is the one thing that fails offline while a perfectly good session is still present.
 *
 * Deleted at build step 6, when the real shell lands.
 */
export function SignInSmokeTest() {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return onAuthStateChanged(getFirebaseAuth(), (next) => {
      setUser(next)
      setReady(true)
    })
  }, [])

  async function handleSignIn() {
    setError(null)
    try {
      await signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider())
    } catch (cause) {
      // Ticket 05's rule for this screen: never an infinite spinner, and never blame the user.
      setError(
        cause instanceof Error
          ? `Can't reach Google to sign in. Check your connection and try again — nothing is lost. (${cause.message})`
          : "Can't reach Google to sign in.",
      )
    }
  }

  if (!ready) return <main className="shell">Checking your session…</main>

  return (
    <main className="shell">
      <h1>NoteMaker</h1>
      <p className="muted">Deploy smoke test — build step 0. No notes here yet.</p>

      {user ? (
        <>
          <dl>
            <dt>uid</dt>
            <dd data-testid="uid">{user.uid}</dd>
          </dl>
          <button onClick={() => void signOut(getFirebaseAuth())}>Sign out</button>
        </>
      ) : (
        <button onClick={() => void handleSignIn()}>Sign in with Google</button>
      )}

      {error && <p role="alert">{error}</p>}
    </main>
  )
}
