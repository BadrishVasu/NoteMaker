// QA, step 6 verification, kept through step 7's move onto a session. A rejected write during Note
// *creation* (quota exhaustion, an eviction mid-write, the row invariant throwing) must not be an
// unhandled promise rejection: `handleNewNote` catches and logs, and the next tap works.

import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { deleteMemoryNoteStore, openMemoryNoteStore } from '../store/memoryNoteStore'
import { stubSession } from '../test/stubSession'
import { AppShell } from './AppShell'

describe('AppShell — a rejected store write during Note creation', () => {
  it('is caught, not an unhandled rejection, and a second attempt succeeds', async () => {
    const unhandled: unknown[] = []
    const onUnhandledRejection = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandledRejection)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    await deleteMemoryNoteStore('create-failure')
    const store = await openMemoryNoteStore('create-failure')
    const real = store.runInTransaction.bind(store)
    let failNext = false
    store.runInTransaction = (fn) => {
      if (failNext) {
        failNext = false
        return Promise.reject(new Error('simulated write rejection (e.g. quota exceeded)'))
      }
      return real(fn)
    }
    const session = await stubSession('u', store)
    try {
      render(<AppShell session={session} userEmail="me@example.com" onSignOut={() => {}} />)
      failNext = true
      await userEvent.click(screen.getAllByRole('button', { name: 'New note' })[0]!)
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(unhandled).toHaveLength(0)
      expect(logged).toHaveBeenCalled()

      await userEvent.click(screen.getAllByRole('button', { name: 'New note' })[0]!)
      await waitFor(() => expect(screen.getByLabelText('Note body')).toBeInTheDocument())
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
      logged.mockRestore()
      store.close()
    }
  })
})
