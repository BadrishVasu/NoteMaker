// Step 7's shell behaviour on a session: the browser back button between two Notes, re-seeding an
// idle open Note on a remote edit (UI/UX, 05-screens Editor), and the engine triggers.

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { asRev } from '../domain/note'
import type { LocalNote } from '../domain/note'
import { deleteMemoryNoteStore, openMemoryNoteStore } from '../store/memoryNoteStore'
import { makeRow, resetRows } from '../test/rows'
import { stubSession } from '../test/stubSession'
import type { StubSession } from '../test/stubSession'
import { AppShell } from './AppShell'

let session: StubSession

async function shellWith(rows: LocalNote[]): Promise<StubSession> {
  await deleteMemoryNoteStore('step7')
  const store = await openMemoryNoteStore('step7')
  for (const r of rows) await store.put(r)
  session = await stubSession('u', store)
  render(<AppShell session={session} userEmail="me@example.com" onSignOut={() => {}} />)
  return session
}

/** An engine-shaped remote adopt: store, then corpus, inside the session's lock. */
const remoteAdopt = (row: LocalNote) =>
  act(() =>
    session.exclusive(async () => {
      await session.store.put(row)
      session.corpus.applyWrites([{ op: 'put', row }])
    }),
  )

beforeEach(() => {
  resetRows()
  history.pushState(null, '', '/')
})
afterEach(() => session.store.close())

describe('AppShell — step 7', () => {
  it('the back button between two Notes remounts the editor on the Note navigated to', async () => {
    const a = makeRow({ title: 'Alpha', titleIsCustom: true, body: 'alpha body' })
    const b = makeRow({ title: 'Beta', titleIsCustom: true, body: 'beta body' })
    await shellWith([a, b])
    await userEvent.click(screen.getByRole('button', { name: 'Alpha' }))
    await userEvent.click(screen.getByRole('button', { name: 'Beta' }))
    expect(screen.getByLabelText('Note body')).toHaveValue('beta body')
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: { noteId: a.id } })))
    expect(screen.getByLabelText('Note body')).toHaveValue('alpha body')
  })

  it('a remote edit to the idle open Note re-seeds it, keeping focus in the body', async () => {
    const a = makeRow({ title: 'Alpha', titleIsCustom: true, body: 'mine' })
    await shellWith([a])
    await userEvent.click(screen.getByRole('button', { name: 'Alpha' }))
    screen.getByLabelText('Note body').focus()
    await remoteAdopt({ ...a, body: 'theirs', rev: asRev('S'), baseRev: asRev('S') })
    await waitFor(() => expect(screen.getByLabelText('Note body')).toHaveValue('theirs'))
    expect(screen.getByLabelText('Note body')).toHaveFocus()
  })

  it('the re-seed and the remount land in one task: no gap where the old textarea types onto the new base', async () => {
    // Mathematician's review, 2026-09-21: `reseed` moves base+buffer at once. If the remount it
    // triggers lands a task later (a passive effect), a keystroke in the old textarea in between
    // commits the OLD text as an ordinary edit on the NEW base — a clean overwrite of the other
    // device. A MutationObserver callback is a microtask after the corpus change's commit, before
    // any later task (the step-6 focus-test technique). Rendered outside `act`, which would flush
    // the passive effect and hide the gap.
    const a = makeRow({ title: 'Alpha', titleIsCustom: true, body: 'mine' })
    await deleteMemoryNoteStore('step7')
    const store = await openMemoryNoteStore('step7')
    await store.put(a)
    session = await stubSession('u', store)
    const { createRoot } = await import('react-dom/client')
    const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const prevAct = g.IS_REACT_ACT_ENVIRONMENT
    g.IS_REACT_ACT_ENVIRONMENT = false
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      root.render(<AppShell session={session} userEmail="me@example.com" onSignOut={() => {}} />)
      await waitFor(() => expect(host.querySelector('button.row')).not.toBeNull())
      ;(host.querySelector('button.row') as HTMLButtonElement).click()
      await waitFor(() => expect(host.querySelector('textarea')).not.toBeNull())
      const theirs = { ...a, body: 'theirs', rev: asRev('S'), baseRev: asRev('S') }
      await store.put(theirs)
      const bodyAtFirstCommit = await new Promise<string | null>((resolve) => {
        const obs = new MutationObserver(() => {
          obs.disconnect()
          resolve(host.querySelector('textarea')?.value ?? null)
        })
        obs.observe(host, { childList: true, subtree: true, characterData: true, attributes: true })
        session.corpus.applyWrites([{ op: 'put', row: theirs }])
      })
      expect(bodyAtFirstCommit).toBe('theirs')
    } finally {
      root.unmount()
      host.remove()
      if (prevAct === undefined) delete g.IS_REACT_ACT_ENVIRONMENT
      else g.IS_REACT_ACT_ENVIRONMENT = prevAct
    }
  })

  it('never re-seeds over unsaved typing', async () => {
    const a = makeRow({ title: 'Alpha', titleIsCustom: true, body: 'mine' })
    await shellWith([a])
    await userEvent.click(screen.getByRole('button', { name: 'Alpha' }))
    await userEvent.type(screen.getByLabelText('Note body'), ' typed')
    await remoteAdopt({ ...a, body: 'theirs', rev: asRev('S'), baseRev: asRev('S') })
    expect(screen.getByLabelText('Note body')).toHaveValue('mine typed')
  })

  it('a committed edit wakes the engine; Sync Now flushes the debounce first, then syncs', async () => {
    const a = makeRow({ title: 'Alpha', titleIsCustom: true, body: 'x' })
    await shellWith([a])
    await userEvent.click(screen.getByRole('button', { name: 'Alpha' }))
    await userEvent.type(screen.getByLabelText('Note body'), 'y')
    expect(session.syncNows).toBe(0)
    await userEvent.click(screen.getAllByRole('button', { name: 'Sync now' })[0]!)
    await waitFor(() => expect(session.syncNows).toBe(1))
    expect((await session.store.get(a.id))?.body).toBe('xy')
    expect(session.wakes).toBeGreaterThan(0)
  })

  it('turning Auto sync on wakes the engine at once', async () => {
    localStorage.setItem('notemaker:autoSync', 'false')
    await shellWith([])
    const before = session.wakes
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /Auto sync/ }))
    expect(session.wakes).toBe(before + 1)
    localStorage.clear()
  })
})
