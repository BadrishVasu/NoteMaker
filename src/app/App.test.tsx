import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { deleteMemoryNoteStore, openMemoryNoteStore } from '../store/memoryNoteStore'
import { stubSession } from '../test/stubSession'
import type { StubSession } from '../test/stubSession'
import type { AuthPort, AuthUser } from '../platform/auth'
import { App } from './App'

// The auth gate (ticket 08: gate on auth STATE, never on tokens) and the session lifecycle the
// Designer ruled for step 7: remount per uid, close a session whose open resolved too late,
// sign-out = flush → close → signOut, and the StorageError screen when the mirror won't open.

function fakeAuth() {
  let listener: ((u: AuthUser | null) => void) | null = null
  const calls: string[] = []
  const auth: AuthPort & { emit(u: AuthUser | null): void; calls: string[]; signInResult: () => Promise<void> } = {
    calls,
    signInResult: () => Promise.resolve(),
    subscribe(l) {
      listener = l
      return () => (listener = null)
    },
    signIn() {
      calls.push('signIn')
      return auth.signInResult()
    },
    async signOut() {
      calls.push('signOut')
    },
    emit(u) {
      act(() => listener?.(u))
    },
  }
  return auth
}

const U1: AuthUser = { uid: 'u1', email: 'one@example.com' }
const U2: AuthUser = { uid: 'u2', email: 'two@example.com' }

let opened: StubSession[] = []
async function openStub(uid: string): Promise<StubSession> {
  await deleteMemoryNoteStore(`app-${uid}`)
  const s = await stubSession(uid, await openMemoryNoteStore(`app-${uid}`))
  opened.push(s)
  return s
}

beforeEach(() => {
  opened = []
  history.pushState(null, '', '/')
})

describe('App — the auth gate', () => {
  it('renders nothing until Firebase has reported the auth state', () => {
    const { container } = render(<App auth={fakeAuth()} openSession={openStub} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('signed out: the SignIn screen, whose button runs the popup', async () => {
    const auth = fakeAuth()
    render(<App auth={auth} openSession={openStub} />)
    auth.emit(null)
    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(auth.calls).toEqual(['signIn'])
  })

  it('a sign-in failure shows the copy for its kind; closing the popup shows nothing', async () => {
    const auth = fakeAuth()
    render(<App auth={auth} openSession={openStub} />)
    auth.emit(null)
    auth.signInResult = () => Promise.reject(Object.assign(new Error('x'), { code: 'auth/popup-closed-by-user' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    auth.signInResult = () => Promise.reject(Object.assign(new Error('x'), { code: 'auth/network-request-failed' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Can.t reach Google/)
  })

  it('an unexpected sign-in failure shows its Firebase code under the generic copy', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const auth = fakeAuth()
    render(<App auth={auth} openSession={openStub} />)
    auth.emit(null)
    auth.signInResult = () => Promise.reject(Object.assign(new Error('x'), { code: 'auth/api-key-expired' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Something went wrong signing in.*\(auth\/api-key-expired\)/)
    spy.mockRestore()
  })

  it('signed in: opens that uid’s session and shows the shell with the user’s email', async () => {
    const auth = fakeAuth()
    const openSession = vi.fn(openStub)
    render(<App auth={auth} openSession={openSession} />)
    auth.emit(U1)
    await screen.findByText('No notes yet.')
    expect(openSession).toHaveBeenCalledWith('u1')
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.getByRole('menuitem', { name: /one@example\.com · Sign out/ })).toBeInTheDocument()
  })

  it('an account switch closes the old session and opens the new one', async () => {
    const auth = fakeAuth()
    render(<App auth={auth} openSession={openStub} />)
    auth.emit(U1)
    await screen.findByText('No notes yet.')
    auth.emit(U2)
    await waitFor(() => expect(opened.map((s) => s.uid)).toEqual(['u1', 'u2']))
    await waitFor(() => expect(opened[0]!.closed).toBe(true))
    expect(opened[1]!.closed).toBe(false)
  })

  it('a session that finishes opening after sign-out is closed and never rendered', async () => {
    const auth = fakeAuth()
    let finish!: () => void
    const late = new Promise<void>((r) => (finish = r))
    const openSession = async (uid: string) => {
      const s = await openStub(uid)
      await late
      return s
    }
    render(<App auth={auth} openSession={openSession} />)
    auth.emit(U1)
    auth.emit(null)
    finish()
    await waitFor(() => expect(opened[0]?.closed).toBe(true))
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument()
  })

  it('sign-out flushes typing into the mirror, closes the session, then signs out — in that order', async () => {
    const auth = fakeAuth()
    render(<App auth={auth} openSession={openStub} />)
    auth.emit(U1)
    await screen.findByText('No notes yet.')
    const session = opened[0]!
    const order: string[] = []
    const close = session.close.bind(session)
    session.close = async () => {
      order.push(`close with ${(await session.store.getAll()).map((r) => r.body).join('|')}`)
      await close()
    }
    const signOut = auth.signOut.bind(auth)
    auth.signOut = async () => {
      order.push('signOut')
      await signOut()
    }
    await userEvent.click(screen.getAllByRole('button', { name: 'New note' })[0]!)
    await userEvent.type(await screen.findByLabelText('Note body'), 'last words')
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /Sign out/ }))
    await waitFor(() => expect(order).toEqual(['close with last words', 'signOut']))
  })

  it('the mirror cannot be opened: the StorageError screen, with Reload', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const auth = fakeAuth()
    render(<App auth={auth} openSession={() => Promise.reject(new Error('IndexedDB unavailable'))} />)
    auth.emit(U1)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Can't open this device's note storage. Nothing has been changed — try reloading.",
    )
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    spy.mockRestore()
  })
})
