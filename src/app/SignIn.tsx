// src/app/SignIn.tsx
// 05-screens.md, "SignIn" and "Sign-in outcomes other than no network" (UI/UX, step 7). Pure
// presentational: `App` runs `signInWithPopup` through platform/auth.ts and maps its rejection
// with `signInErrorOf`. One slot under the button; the three messages are mutually exclusive.

import { EmptyStates } from './EmptyStates'

export type SignInError = 'network' | 'blocked' | 'other'

/** Which copy a sign-in rejection gets. The user closing the popup is not a failure: null. */
/** The Firebase error code of a rejection, if it carries one. */
export function errorCodeOf(error: unknown): string | null {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
  return typeof code === 'string' ? code : null
}

export function signInErrorOf(error: unknown): SignInError | null {
  const code = errorCodeOf(error)
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null
  if (code === 'auth/network-request-failed') return 'network'
  if (code === 'auth/popup-blocked') return 'blocked'
  return 'other'
}

export interface SignInProps {
  onSignIn: () => void
  error: SignInError | null
  /** Shown only in the residual 'other' bucket: there the code is the one actionable fact, and a
   *  phone has no console (found in Badrish's live test: an expired API key read as "check your
   *  connection"). The named cases have copy that already says what to do. */
  errorCode?: string | null
}

export function SignIn({ onSignIn, error, errorCode = null }: SignInProps) {
  return (
    <main className="signin">
      <h1>NoteMaker</h1>
      <p className="tagline">Markdown notes that work offline and sync across your devices.</p>
      <button type="button" onClick={onSignIn}>
        Continue with Google
      </button>
      {error === 'network' && <EmptyStates kind="signin-offline" />}
      {error === 'blocked' && (
        <p role="alert">Your browser blocked the sign-in popup. Allow popups for this site, then try again.</p>
      )}
      {error === 'other' && (
        <p role="alert">
          Something went wrong signing in. Check your connection and try again — nothing is lost.
          {errorCode !== null && <span className="error-code"> ({errorCode})</span>}
        </p>
      )}
    </main>
  )
}
