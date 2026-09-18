import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SignIn } from './SignIn'

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

  it('shows the no-network failure copy under the button when there is an error', () => {
    render(<SignIn onSignIn={() => {}} error="failed" />)
    expect(screen.getByRole('alert')).toHaveTextContent(/Can.t reach Google to sign in/)
  })
})
