import { createFirebaseAuth } from './auth'

// The SDK is mocked: this file is glue, and what's worth pinning is the shape of the glue —
// the UI sees a uid and an email or null (never a token, ticket 08), sign-in is a popup (08:
// redirect is broken on our pages.dev / firebaseapp.com origin split), and sign-out is signOut.

const sdk = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}))
vi.mock('firebase/auth', () => sdk)

const fakeAuth = { name: 'fake-auth' } as never

describe('platform/auth', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports a signed-in user as uid and email only, and signed out as null', () => {
    const unsubscribe = vi.fn()
    let listener!: (u: unknown) => void
    sdk.onAuthStateChanged.mockImplementation((_auth: unknown, cb: (u: unknown) => void) => {
      listener = cb
      return unsubscribe
    })
    const seen: unknown[] = []
    const stop = createFirebaseAuth(() => fakeAuth).subscribe((u) => seen.push(u))
    listener({ uid: 'u1', email: 'a@b.c', getIdToken: () => 'secret', refreshToken: 'r' })
    listener(null)
    expect(seen).toEqual([{ uid: 'u1', email: 'a@b.c' }, null])
    expect(sdk.onAuthStateChanged.mock.calls[0]![0]).toBe(fakeAuth)
    stop()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('signs in with a Google popup, never a redirect', async () => {
    sdk.signInWithPopup.mockResolvedValue({})
    await createFirebaseAuth(() => fakeAuth).signIn()
    expect(sdk.signInWithPopup).toHaveBeenCalledWith(fakeAuth, expect.any(sdk.GoogleAuthProvider))
    expect(sdk.signInWithRedirect).not.toHaveBeenCalled()
  })

  it('passes a failed sign-in through for the SignIn screen to show', async () => {
    sdk.signInWithPopup.mockRejectedValue(new Error('auth/network-request-failed'))
    await expect(createFirebaseAuth(() => fakeAuth).signIn()).rejects.toThrow('network-request-failed')
  })

  it('signs out through the SDK', async () => {
    sdk.signOut.mockResolvedValue(undefined)
    await createFirebaseAuth(() => fakeAuth).signOut()
    expect(sdk.signOut).toHaveBeenCalledWith(fakeAuth)
  })
})
