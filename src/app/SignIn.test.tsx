import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SignIn, signInErrorOf } from './SignIn'

describe('SignIn', () => {
  it('renders the primary Google sign-in action and calls onSignIn', async () => {
    const onSignIn = vi.fn()
    render(<SignIn onSignIn={onSignIn} error={null} />)
    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(onSignIn).toHaveBeenCalled()
  })

  it('shows no failure copy when there is no error', () => {
    render(<SignIn onSignIn={() => {}} error={null} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the no-network copy for a network failure', () => {
    render(<SignIn onSignIn={() => {}} error="network" />)
    expect(screen.getByRole('alert')).toHaveTextContent(/Can.t reach Google to sign in/)
  })

  it('shows the blocked-popup copy when the browser blocked the popup (05-screens, step 7)', () => {
    render(<SignIn onSignIn={() => {}} error="blocked" />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your browser blocked the sign-in popup. Allow popups for this site, then try again.',
    )
  })

  it('shows the generic copy for anything else', () => {
    render(<SignIn onSignIn={() => {}} error="other" />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Something went wrong signing in. Check your connection and try again — nothing is lost.',
    )
  })
})

describe('signInErrorOf — which copy a signInWithPopup rejection gets', () => {
  const err = (code: string) => Object.assign(new Error(code), { code })
  it('the user closing the popup is not an error', () => {
    expect(signInErrorOf(err('auth/popup-closed-by-user'))).toBeNull()
    expect(signInErrorOf(err('auth/cancelled-popup-request'))).toBeNull()
  })
  it('maps network, blocked, and everything else', () => {
    expect(signInErrorOf(err('auth/network-request-failed'))).toBe('network')
    expect(signInErrorOf(err('auth/popup-blocked'))).toBe('blocked')
    expect(signInErrorOf(err('auth/internal-error'))).toBe('other')
    expect(signInErrorOf('not even an error')).toBe('other')
  })
})
