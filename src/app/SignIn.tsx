// src/app/SignIn.tsx
// 05-screens.md, "SignIn" section. Pure presentational component — auth itself is step 7.
// Not mounted in the app flow at step 6 (main.tsx opens straight onto the list against a fixed
// local uid); built now so step 7 only has to wire `onSignIn`/`error`, not design a screen.

import { EmptyStates } from './EmptyStates'

export interface SignInProps {
  onSignIn: () => void
  error: string | null
}

export function SignIn({ onSignIn, error }: SignInProps) {
  return (
    <main className="signin">
      <h1>NoteMaker</h1>
      <p className="tagline">Markdown notes that work offline and sync across your devices.</p>
      <button type="button" onClick={onSignIn}>
        Continue with Google
      </button>
      {error !== null && <EmptyStates kind="signin-offline" />}
    </main>
  )
}
