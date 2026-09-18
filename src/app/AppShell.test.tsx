import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { createCorpus } from '../sync/corpus'
import { asNoteId } from '../domain/note'
import userEvent from '@testing-library/user-event'
import 'fake-indexeddb/auto'
import { AppShell } from './AppShell'
import { openIdbNoteStore } from '../store/idbNoteStore'

// AppShell opens `notemaker-local` via idb (real IndexedDB API, backed by fake-indexeddb in
// jsdom). Each test gets a clean database.
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

  it('shows the downloading state briefly, then settles to the genuinely-empty state', async () => {
    render(<AppShell />)
    await waitFor(() => expect(screen.getByText('No notes yet.')).toBeInTheDocument())
  })

  it('creating a note opens it in the editor with a Default title and focuses the body', async () => {
    render(<AppShell />)
    await waitUntilReady()
    await userEvent.click(screen.getAllByRole('button', { name: 'New note' })[0]!)
    await waitFor(() => expect(screen.getByLabelText('Note body')).toBeInTheDocument())
    expect(screen.getByLabelText('Note body')).toHaveFocus()
  })

  it('typing a title latches it permanently, and the row reflects the saved title after a flush', async () => {
    render(<AppShell />)
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
    render(<AppShell />)
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
    render(<AppShell />)
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
    const corpus = createCorpus()
    render(<AppShell corpus={corpus} />)
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
    render(<AppShell />)
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
    render(<AppShell />)
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
})
