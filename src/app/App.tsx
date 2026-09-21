// src/app/App.tsx — the auth gate and the session lifecycle (architecture.md, "Composition root").
//
// Ticket 08: the UI is gated on auth STATE, never on tokens. Until Firebase has reported it
// (it reads the stored session from IndexedDB, offline too, in well under 100 ms) this renders
// nothing — no splash (UI/UX, step 7). Signed out: `SignIn`. Signed in: the uid's `Session`,
// opened through the injected `openSession` (main.tsx wires the real one), and `AppShell` keyed
// by uid so an account switch is a clean remount.
//
// Designer's amendments: a session whose open resolves after its uid stopped being current is
// closed and never rendered; sign-out is flush (AppShell) → `session.close()` → `auth.signOut()`.

import { useEffect, useState } from 'react'
import type { AuthPort, AuthUser } from '../platform/auth'
import type { Session } from '../session'
import { AppShell } from './AppShell'
import { SignIn, errorCodeOf, signInErrorOf } from './SignIn'
import type { SignInError } from './SignIn'
import { StorageError } from './StorageError'

export interface AppProps {
  auth: AuthPort
  openSession: (uid: string) => Promise<Session>
}

export function App({ auth, openSession }: AppProps) {
  /** undefined = Firebase hasn't said yet; null = signed out. */
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined)
  const [signInError, setSignInError] = useState<SignInError | null>(null)
  const [signInErrorCode, setSignInErrorCode] = useState<string | null>(null)
  // Keyed by uid, so a stale value from the previous account is simply not current — nothing has
  // to be reset from inside an effect.
  const [opened, setOpened] = useState<{ uid: string; session: Session } | null>(null)
  const [failedUid, setFailedUid] = useState<string | null>(null)

  useEffect(() => auth.subscribe(setUser), [auth])

  const uid = user?.uid ?? null
  useEffect(() => {
    if (uid === null) return
    let current = true
    let session: Session | null = null
    openSession(uid).then(
      (s) => {
        session = s
        if (current) setOpened({ uid, session: s })
        else void s.close() // signed out or switched while it was opening
      },
      (err: unknown) => {
        console.error('App: opening the note storage for this account failed', err)
        if (current) setFailedUid(uid)
      },
    )
    return () => {
      current = false
      void session?.close()
    }
  }, [uid, openSession])

  function handleSignIn(): void {
    setSignInError(null)
    setSignInErrorCode(null)
    auth.signIn().catch((err: unknown) => {
      const kind = signInErrorOf(err)
      if (kind !== 'network' && kind !== null) console.error('App: sign-in failed', err)
      setSignInError(kind)
      setSignInErrorCode(errorCodeOf(err))
    })
  }

  if (user === undefined) return null
  if (user === null) return <SignIn onSignIn={handleSignIn} error={signInError} errorCode={signInErrorCode} />
  if (failedUid === user.uid) return <StorageError />
  if (opened === null || opened.uid !== user.uid) return null

  const { session } = opened
  const signOut = (): void => {
    void session
      .close()
      .then(() => auth.signOut())
      .catch((err: unknown) => console.error('App: signing out failed', err))
  }

  return <AppShell key={user.uid} session={session} userEmail={user.email ?? user.uid} onSignOut={signOut} />
}
