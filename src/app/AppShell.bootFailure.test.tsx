// Builder, step 6 (from Frontend's review note: check every fire-and-forget async in AppShell, not
// only the one QA found). If the local mirror cannot be opened at all (IndexedDB disabled or
// blocked, a private window that refuses storage), the boot effect's rejection was unhandled and
// the shell sat on "Getting your notes…" forever — the infinite-spinner failure 05 forbids
// everywhere. Own module so the mock cannot reach AppShell.test.tsx.

import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('../store/idbNoteStore', () => ({
  openIdbNoteStore: async () => {
    throw new Error('simulated: IndexedDB unavailable')
  },
}))

const { AppShell } = await import('./AppShell')

describe('AppShell — the local mirror cannot be opened', () => {
  it('says so instead of showing "Getting your notes…" forever, and nothing is unhandled', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(<AppShell />)
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(
          "Can't open this device's note storage. Nothing has been changed — try reloading.",
        ),
      )
      expect(screen.queryByText('Getting your notes…')).not.toBeInTheDocument()
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(unhandled).toHaveLength(0)
      expect(logged).toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', onUnhandled)
      logged.mockRestore()
    }
  })
})
