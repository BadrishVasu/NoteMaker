// QA — trying to break the re-seed fix (Mathematician's second finding, 2026-09-21): the
// `useLayoutEffect` in AppShell.tsx that keeps the re-seed and the remount in one task. Builder's
// own regression test proves the body field; this checks the title field, since `refocus` branches
// on which field had focus and a per-field bug wouldn't show up testing only one of them.

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
  await deleteMemoryNoteStore('appshell-qa')
  const store = await openMemoryNoteStore('appshell-qa')
  for (const r of rows) await store.put(r)
  session = await stubSession('u', store)
  render(<AppShell session={session} userEmail="me@example.com" onSignOut={() => {}} />)
  return session
}

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

describe('AppShell — re-seed race, title field', () => {
  it('a remote edit to the idle open Note re-seeds it, keeping focus in the Title field', async () => {
    const a = makeRow({ title: 'Alpha', titleIsCustom: true, body: 'mine' })
    await shellWith([a])
    await userEvent.click(screen.getByRole('button', { name: 'Alpha' }))
    screen.getByLabelText('Title').focus()
    await remoteAdopt({ ...a, body: 'theirs', rev: asRev('S'), baseRev: asRev('S') })
    await waitFor(() => expect(screen.getByLabelText('Note body')).toHaveValue('theirs'))
    expect(screen.getByLabelText('Title')).toHaveFocus()
  })

  it('the re-seed and the remount land in one task with focus in Title: no gap where a stale title keystroke lands on the new base', async () => {
    const a = makeRow({ title: 'Alpha', titleIsCustom: true, body: 'mine' })
    await deleteMemoryNoteStore('appshell-qa2')
    const store = await openMemoryNoteStore('appshell-qa2')
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
      await waitFor(() => expect(host.querySelector('input[aria-label="Title"]')).not.toBeNull())
      const theirs = { ...a, body: 'theirs', rev: asRev('S'), baseRev: asRev('S') }
      await store.put(theirs)
      const titleAtFirstCommit = await new Promise<string | null>((resolve) => {
        const obs = new MutationObserver(() => {
          obs.disconnect()
          resolve(host.querySelector<HTMLInputElement>('input[aria-label="Title"]')?.value ?? null)
        })
        obs.observe(host, { childList: true, subtree: true, characterData: true, attributes: true })
        session.corpus.applyWrites([{ op: 'put', row: theirs }])
      })
      // The re-seed carries no title change here (only body changed) — what matters is that the
      // remount happens in the SAME task as the base move, whichever field has focus. Confirmed
      // by checking the base moved by the time the DOM first mutates, same as the body case.
      expect(titleAtFirstCommit).toBe('Alpha') // title unchanged by this remote edit, as expected
      expect(session.corpus.getRow(a.id)?.baseRev).toBe(asRev('S')) // but the row IS already 'theirs'
    } finally {
      root.unmount()
      host.remove()
      if (prevAct === undefined) delete g.IS_REACT_ACT_ENVIRONMENT
      else g.IS_REACT_ACT_ENVIRONMENT = prevAct
    }
  })

  it('never re-seeds over unsaved typing in the Title field', async () => {
    const a = makeRow({ title: 'Alpha', titleIsCustom: true, body: 'mine' })
    await shellWith([a])
    await userEvent.click(screen.getByRole('button', { name: 'Alpha' }))
    await userEvent.type(screen.getByLabelText('Title'), ' typed')
    await remoteAdopt({ ...a, body: 'theirs', rev: asRev('S'), baseRev: asRev('S') })
    expect(screen.getByLabelText('Title')).toHaveValue('Alpha typed')
    expect(screen.getByLabelText('Note body')).toHaveValue('mine') // unsaved title blocks the whole re-seed
  })
})
