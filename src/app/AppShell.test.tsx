import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { asNoteId } from '../domain/note'
import userEvent from '@testing-library/user-event'
import 'fake-indexeddb/auto'
import { AppShell } from './AppShell'
import { openIdbNoteStore } from '../store/idbNoteStore'
import type { NoteStore } from '../store/noteStore'
import { stubSession } from '../test/stubSession'
import type { StubSession } from '../test/stubSession'
import type { SessionStatus } from '../session'

// Step 7: `App` hands AppShell a running session. Here that is a stub (no engine) over the real
// `notemaker-local` IndexedDB database (fake-indexeddb in jsdom); tests that inspect the mirror
// open a second connection to the same database.
const connections: NoteStore[] = []
async function renderShell(status: Partial<SessionStatus> = {}): Promise<StubSession> {
  const store = await openIdbNoteStore('local')
  connections.push(store)
  const session = await stubSession('local', store, status)
  render(<AppShell session={session} userEmail="me@example.com" onSignOut={() => {}} />)
  return session
}
afterEach(() => {
  for (const c of connections.splice(0)) c.close()
})
async function resetLocalDb(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('notemaker-local')
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

async function waitUntilReady(): Promise<void> {
  await waitFor(() => expect(screen.queryByText('Getting your notes…')).not.toBeInTheDocument())
}

// The suite runs its tests in order (vitest does not shuffle by default) and only the first
// test depends on a genuinely empty mirror, so the database is reset once, up front — resetting
// it between every test risks racing a not-yet-closed IndexedDB connection from the previous
// test's unmount, which hangs `deleteDatabase` indefinitely under fake-indexeddb. Every other
// test's assertions are scoped to content it created itself and tolerate leftover rows from
// earlier tests in the same file.
describe('AppShell', () => {
  beforeAll(async () => {
    await resetLocalDb()
  })

  beforeEach(() => {
    history.pushState(null, '', '/')
  })

  it('the first-load states follow the session: downloading, waiting for a connection, then genuinely empty', async () => {
    const session = await renderShell({ initialSyncCompletedAt: null })
    expect(await screen.findByText('Getting your notes…')).toBeInTheDocument()
    act(() => session.setStatus({ waitingForConnection: true }))
    expect(screen.getByText('Waiting for a connection.')).toBeInTheDocument()
    expect(screen.queryByText('Getting your notes…')).not.toBeInTheDocument()
    act(() => session.setStatus({ waitingForConnection: false, initialSyncCompletedAt: 5 }))
    expect(screen.getByText('No notes yet.')).toBeInTheDocument()
  })

  it('a returning device (stamp already set) shows no loading state at all', async () => {
    await renderShell({ initialSyncCompletedAt: 5 })
    expect(screen.queryByText('Getting your notes…')).not.toBeInTheDocument()
  })

  it('creating a note opens it in the editor with a Default title and focuses the body', async () => {
    await renderShell()
    await waitUntilReady()
    await userEvent.click(screen.getAllByRole('button', { name: 'New note' })[0]!)
    await waitFor(() => expect(screen.getByLabelText('Note body')).toBeInTheDocument())
    expect(screen.getByLabelText('Note body')).toHaveFocus()
  })

  it('typing a title latches it permanently, and the row reflects the saved title after a flush', async () => {
    await renderShell()
    await waitUntilReady()
    await userEvent.click(screen.getAllByRole('button', { name: 'New note' })[0]!)
    await waitFor(() => expect(screen.getByLabelText('Note body')).toBeInTheDocument())

    await userEvent.type(screen.getByLabelText('Note body'), 'Hello world')
    await userEvent.type(screen.getByLabelText('Title'), 'My Title')

    await waitFor(
      () => expect(screen.getByRole('button', { name: 'My Title' })).toBeInTheDocument(),
      { timeout: 2000 },
    )
  })

  it('typing a title THEN the body keeps the typed title — the body keystroke must not un-latch it', async () => {
    // The order the test above does not exercise. Before the builder's step-6 fix, the body
    // handler's patch carried the corpus row's old title and titleIsCustom:false, replacing the
    // pending title patch — so the saved title became the derived "Later body text".
    await renderShell()
    await waitUntilReady()
    await userEvent.click(screen.getAllByRole('button', { name: 'New note' })[0]!)
    await waitFor(() => expect(screen.getByLabelText('Note body')).toBeInTheDocument())

    await userEvent.type(screen.getByLabelText('Title'), 'Kept Title')
    await userEvent.type(screen.getByLabelText('Note body'), 'Later body text')

    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Kept Title' })).toBeInTheDocument(),
      { timeout: 2000 },
    )
    expect(screen.queryByRole('button', { name: 'Later body text' })).not.toBeInTheDocument()
  })

  it('does not write initialSyncCompletedAt — only the sync engine may stamp it', async () => {
    // architecture.md: stamped by engine.ts on a complete server batch. Step 6 has no engine, so
    // the shell treats the local mirror as settled IN MEMORY for display, and persists nothing
    // that claims a server sync happened.
    await renderShell()
    await waitUntilReady()
    const store = await openIdbNoteStore('local')
    try {
      expect(await store.getMeta('initialSyncCompletedAt')).toBeUndefined()
    } finally {
      store.close()
    }
  })

  it('the conflict redirect: same textarea, same text, same selection, replaceState only, banner shown', async () => {
    // 02 / 05 §9, wired end to end through the shell. The Editor unit test proves the component
    // can preserve its state; this proves the shell does not throw it away (a remount, a key
    // change, or a pushState here would each pass every other test in this file).
    const { corpus } = await renderShell()
    await waitUntilReady()
    await userEvent.click(screen.getAllByRole('button', { name: 'New note' })[0]!)
    await waitFor(() => expect(screen.getByLabelText('Note body')).toBeInTheDocument())
    await userEvent.type(screen.getByLabelText('Note body'), 'My version of the text')
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'My version of the text' })).toBeInTheDocument(),
      { timeout: 2000 },
    )

    const textarea = screen.getByLabelText('Note body') as HTMLTextAreaElement
    textarea.setSelectionRange(3, 10)
    const from = [...corpus.getRows().values()].find((r) => r.body === 'My version of the text')!
    const copy = { ...from, id: asNoteId(`${from.id}__cdev__r9`), conflictOf: from.id }

    const push = vi.spyOn(history, 'pushState')
    const replace = vi.spyOn(history, 'replaceState')
    act(() => {
      corpus.applyWrites([{ op: 'put', row: copy }])
      corpus.redirect(from.id, copy.id)
    })

    const after = screen.getByLabelText('Note body') as HTMLTextAreaElement
    expect(after).toBe(textarea)
    expect(after.value).toBe('My version of the text')
    expect(after.selectionStart).toBe(3)
    expect(after.selectionEnd).toBe(10)
    expect(replace).toHaveBeenCalledWith({ noteId: copy.id }, '')
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByText(/This note was edited on another device too/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Compare' })).toBeInTheDocument()
    push.mockRestore()
    replace.mockRestore()
  })

  it('deleting a note moves it to Trash, and it can be restored', async () => {
    await renderShell()
    await waitUntilReady()
    await userEvent.click(screen.getAllByRole('button', { name: 'New note' })[0]!)
    await waitFor(() => expect(screen.getByLabelText('Note body')).toBeInTheDocument())
    await userEvent.type(screen.getByLabelText('Note body'), 'Doomed note')

    await userEvent.click(screen.getByRole('button', { name: 'Move to Trash' }))
    // Trash is read-only, not absent (05-screens.md §4): the body stays in the DOM, disabled.
    await waitFor(() => expect(screen.getByLabelText('Note body')).toBeDisabled())

    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Trash' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Doomed note/ })).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /Doomed note/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument())
  })

  it('search filters the list and shows the no-results empty state', async () => {
    await renderShell()
    await waitUntilReady()
    await userEvent.click(screen.getAllByRole('button', { name: 'New note' })[0]!)
    await waitFor(() => expect(screen.getByLabelText('Note body')).toBeInTheDocument())
    await userEvent.type(screen.getByLabelText('Note body'), 'Findable content')
    await waitFor(
      () => expect(screen.getByRole('button', { name: /Findable content/ })).toBeInTheDocument(),
      { timeout: 2000 },
    )

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search notes' }), 'zzz-nomatch')
    await waitFor(() => expect(screen.getByText('No notes match "zzz-nomatch"')).toBeInTheDocument())
  })

  // QA, step 6 verification. The debounce is keyed per-Note in `saveNote.ts`'s queue, not tied
  // to Editor's mount lifecycle — so switching Notes before the 600ms timer fires must not lose
  // the abandoned Note's keystrokes even though its Editor instance unmounts underneath them.
  it('switching to a different Note mid-debounce still saves the Note left behind', async () => {
    await renderShell()
    await waitUntilReady()
    await userEvent.click(screen.getAllByRole('button', { name: 'New note' })[0]!)
    await waitFor(() => expect(screen.getByLabelText('Note body')).toBeInTheDocument())
    await userEvent.type(screen.getByLabelText('Note body'), 'Left behind mid-debounce')

    // Switch away before 600ms elapses — no explicit wait for the first Note's save.
    await userEvent.click(screen.getAllByRole('button', { name: 'New note' })[0]!)
    await waitFor(() => expect(screen.getByLabelText('Note body')).toHaveValue(''))

    const store = await openIdbNoteStore('local')
    try {
      await waitFor(
        async () => {
          const rows = await store.getAll()
          expect(rows.some((r) => r.body === 'Left behind mid-debounce')).toBe(true)
        },
        { timeout: 2000 },
      )
    } finally {
      store.close()
    }
  })

  it('deleting immediately after typing keeps the just-typed text on the trashed row', async () => {
    await renderShell()
    await waitUntilReady()
    await userEvent.click(screen.getAllByRole('button', { name: 'New note' })[0]!)
    await waitFor(() => expect(screen.getByLabelText('Note body')).toBeInTheDocument())
    await userEvent.type(screen.getByLabelText('Note body'), 'About to be deleted')
    // No wait for the debounce: delete fires while the edit is still only pending.
    await userEvent.click(screen.getByRole('button', { name: 'Move to Trash' }))
    await waitFor(() => expect(screen.getByLabelText('Note body')).toBeDisabled())
    expect(screen.getByLabelText('Note body')).toHaveValue('About to be deleted')

    const store = await openIdbNoteStore('local')
    try {
      await waitFor(async () => {
        const rows = await store.getAll()
        const row = rows.find((r) => r.body === 'About to be deleted')
        expect(row).toBeDefined()
        expect(row?.deletedAt).not.toBeNull()
      })
    } finally {
      store.close()
    }
  })

  it('restoring, then typing immediately (mid-debounce), saves the post-restore edit', async () => {
    await renderShell()
    await waitUntilReady()
    await userEvent.click(screen.getAllByRole('button', { name: 'New note' })[0]!)
    await waitFor(() => expect(screen.getByLabelText('Note body')).toBeInTheDocument())
    await userEvent.type(screen.getByLabelText('Note body'), 'Will be restored')
    await waitFor(
      () => expect(screen.getByRole('button', { name: /Will be restored/ })).toBeInTheDocument(),
      { timeout: 2000 },
    )
    await userEvent.click(screen.getByRole('button', { name: 'Move to Trash' }))
    await waitFor(() => expect(screen.getByLabelText('Note body')).toBeDisabled())

    await userEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(screen.getByLabelText('Note body')).not.toBeDisabled())
    // Restore itself flushes synchronously (handleRestore calls flush(id)); the real risk this
    // test targets is the very next keystroke, typed before that restore's own debounce cycle
    // settles, still landing correctly rather than reverting deletedAt or the body.
    await userEvent.type(screen.getByLabelText('Note body'), ' plus more')

    const store = await openIdbNoteStore('local')
    try {
      await waitFor(
        async () => {
          const rows = await store.getAll()
          const row = rows.find((r) => r.body === 'Will be restored plus more')
          expect(row).toBeDefined()
          expect(row?.deletedAt).toBeNull()
        },
        { timeout: 2000 },
      )
    } finally {
      store.close()
    }
  })

  // 05-screens.md §5: the number shown in the Custom-emptied hint must be the number that
  // actually lands on save — never a guess independent of `nextUntitledN`.
  it('the Custom-emptied hint number matches the Default title the note actually saves as', async () => {
    await renderShell()
    await waitUntilReady()
    await userEvent.click(screen.getAllByRole('button', { name: 'New note' })[0]!)
    await waitFor(() => expect(screen.getByLabelText('Note body')).toBeInTheDocument())

    await userEvent.type(screen.getByLabelText('Title'), 'Temp')
    await userEvent.clear(screen.getByLabelText('Title'))

    const hint = await screen.findByText(/It.s listed as/)
    const match = /Untitled Note (\d+)/.exec(hint.textContent ?? '')
    expect(match).not.toBeNull()
    const predictedN = match![1]

    await waitFor(
      () =>
        expect(screen.getByRole('button', { name: `Untitled Note ${predictedN}` })).toBeInTheDocument(),
      { timeout: 2000 },
    )
  })

  // Lifecycle flush end-to-end (05-screens.md §4 + platform/lifecycle.ts): a window `blur` must
  // write a pending edit well before the 600ms debounce would have fired on its own.
  it('a window blur flushes a pending edit before the debounce timer fires', async () => {
    await renderShell()
    await waitUntilReady()
    await userEvent.click(screen.getAllByRole('button', { name: 'New note' })[0]!)
    await waitFor(() => expect(screen.getByLabelText('Note body')).toBeInTheDocument())
    await userEvent.type(screen.getByLabelText('Note body'), 'Blur me')
    window.dispatchEvent(new Event('blur'))

    const store = await openIdbNoteStore('local')
    try {
      await waitFor(
        async () => {
          const rows = await store.getAll()
          expect(rows.some((r) => r.body === 'Blur me')).toBe(true)
        },
        { timeout: 400 },
      )
    } finally {
      store.close()
    }
  })

  // Same lifecycle wiring, the `visibilitychange -> hidden` signal (Android backgrounding).
  it('visibilitychange to hidden flushes a pending edit before the debounce timer fires', async () => {
    await renderShell()
    await waitUntilReady()
    await userEvent.click(screen.getAllByRole('button', { name: 'New note' })[0]!)
    await waitFor(() => expect(screen.getByLabelText('Note body')).toBeInTheDocument())
    await userEvent.type(screen.getByLabelText('Note body'), 'Hide me')
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    const store = await openIdbNoteStore('local')
    try {
      await waitFor(
        async () => {
          const rows = await store.getAll()
          expect(rows.some((r) => r.body === 'Hide me')).toBe(true)
        },
        { timeout: 400 },
      )
    } finally {
      store.close()
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    }
  })
})
