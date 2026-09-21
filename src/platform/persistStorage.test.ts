import { requestPersist } from './persistStorage'

// Ticket 03: `navigator.storage.persist()` on first successful sign-in, retried silently once per
// open while denied. This file is the browser edge only: it answers "is storage persistent now?"
// and never throws. The once-per-open policy and the `meta.persistGranted` record are session.ts's.

type StorageLike = Pick<StorageManager, 'persist' | 'persisted'>

function storage(over: Partial<Record<keyof StorageLike, () => Promise<boolean>>>): StorageLike {
  return {
    persisted: over.persisted ?? (() => Promise.resolve(false)),
    persist: over.persist ?? (() => Promise.resolve(false)),
  }
}

describe('platform/persistStorage', () => {
  it('returns true without asking again when storage is already persistent', async () => {
    const persist = vi.fn(() => Promise.resolve(false))
    await expect(requestPersist(storage({ persisted: () => Promise.resolve(true), persist }))).resolves.toBe(true)
    expect(persist).not.toHaveBeenCalled()
  })

  it('asks, and returns what the browser granted', async () => {
    await expect(requestPersist(storage({ persist: () => Promise.resolve(true) }))).resolves.toBe(true)
    await expect(requestPersist(storage({ persist: () => Promise.resolve(false) }))).resolves.toBe(false)
  })

  it('reports false, never throws, when the API is missing or rejects', async () => {
    await expect(requestPersist(undefined)).resolves.toBe(false)
    await expect(requestPersist({} as StorageLike)).resolves.toBe(false)
    await expect(requestPersist(storage({ persist: () => Promise.reject(new Error('blocked')) }))).resolves.toBe(false)
    await expect(requestPersist(storage({ persisted: () => Promise.reject(new Error('blocked')) }))).resolves.toBe(false)
  })
})
