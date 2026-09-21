// QA, step 6 verification. `AppShell.handleNewNote` awaits `commitCreate` with no `.catch` —
// unlike the save queue's own `writeNow`, which wraps every commit in a `.catch` that logs and
// keeps the chain usable (saveNote.ts). A rejected `store.put` during Note *creation* (quota
// exhaustion, a browser storage eviction mid-write, or the row invariant throwing) is therefore
// an unhandled promise rejection: nothing is shown to the user, no Note opens, and — depending on
// the test/production environment's unhandled-rejection policy — this can crash the tab instead
// of degrading gracefully. This file isolates the mock in its own module so it cannot affect
// `AppShell.test.tsx`'s shared `notemaker-local` database or its other assertions.

import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import 'fake-indexeddb/auto'

let failNextPut = false

vi.mock('../store/idbNoteStore', async () => {
  const actual = await vi.importActual<typeof import('../store/idbNoteStore')>('../store/idbNoteStore')
  return {
    ...actual,
    openIdbNoteStore: async (uid: string) => {
      const store = await actual.openIdbNoteStore(uid)
      const originalPut = store.put.bind(store)
      store.put = async (row) => {
        if (failNextPut) {
          failNextPut = false
          throw new Error('simulated store.put rejection (e.g. quota exceeded)')
        }
        return originalPut(row)
      }
      return store
    },
  }
})

// Imported after the mock so AppShell picks up the wrapped store.
const { AppShell } = await import('./AppShell')

describe('AppShell — a rejected store.put during Note creation', () => {
  afterEach(() => {
    failNextPut = false
  })

  it('does not silently strand the user: a rejected creation must not be an unhandled rejection', async () => {
    // Node-level, not `window`'s DOM event: jsdom/vitest surface an unhandled promise rejection
    // via the process, not a `window.unhandledrejection` DOM event — which is exactly why this
    // failure mode is easy to miss in a browser dev-console check too (nothing renders, nothing
    // throws visibly; vitest only flags it because it instruments the process).
    const unhandled: unknown[] = []
    const onUnhandledRejection = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandledRejection)

    render(<AppShell />)
    await waitFor(() =>
      expect(screen.queryByText('Getting your notes…')).not.toBeInTheDocument(),
    )

    failNextPut = true
    await userEvent.click(screen.getAllByRole('button', { name: 'New note' })[0]!)

    // Give the rejected promise a turn to either be caught or surface as unhandled.
    await new Promise((resolve) => setTimeout(resolve, 50))

    process.off('unhandledRejection', onUnhandledRejection)

    // DEFECT found by QA at step 6 (see qa.md): `handleNewNote` awaited `commitCreate` with no
    // `.catch`. Fixed by builder, 2026-09-21 — this test was red before the fix and is the
    // regression guard now.
    expect(unhandled).toHaveLength(0)

    // The app should still be usable afterwards regardless: a second attempt must succeed.
    await userEvent.click(screen.getAllByRole('button', { name: 'New note' })[0]!)
    await waitFor(() => expect(screen.getByLabelText('Note body')).toBeInTheDocument())
  })
})
