import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NoteList } from './NoteList'
import { makeRow, resetRows } from '../test/rows'
import { asRev } from '../domain/note'

function baseProps(overrides: Partial<React.ComponentProps<typeof NoteList>> = {}) {
  return {
    notes: [],
    view: 'notes' as const,
    activeId: null,
    query: '',
    onQueryChange: vi.fn(),
    onSelect: vi.fn(),
    onNewNote: vi.fn(),
    autoSync: true,
    onToggleAutoSync: vi.fn(),
    onSyncNow: vi.fn(),
    onToggleTrash: vi.fn(),
    onSignOut: vi.fn(),
    userEmail: 'someone@example.com',
    emptyKind: null,
    ...overrides,
  }
}

describe('NoteList', () => {
  beforeEach(() => resetRows())

  it('renders a row per note, titled and ordered as given', () => {
    const rows = [makeRow({ title: 'First' }), makeRow({ title: 'Second' })]
    render(<NoteList {...baseProps({ notes: rows })} />)
    const buttons = screen.getAllByRole('button', { name: /First|Second/ })
    expect(buttons.map((b) => b.querySelector('.row-title')?.textContent)).toEqual([
      'First',
      'Second',
    ])
  })

  it('marks the active row with aria-current', () => {
    const rows = [makeRow({ title: 'Active one' })]
    const [activeRow] = rows
    render(<NoteList {...baseProps({ notes: rows, activeId: activeRow?.id ?? null })} />)
    expect(screen.getByRole('button', { name: 'Active one' })).toHaveAttribute('aria-current', 'true')
  })

  it('a row is a button, not a link, named by its visible title', () => {
    const rows = [makeRow({ title: 'Grocery list' })]
    render(<NoteList {...baseProps({ notes: rows })} />)
    const row = screen.getByRole('button', { name: 'Grocery list' })
    expect(row.tagName).toBe('BUTTON')
  })

  it('shows the downloading empty state when the caller says so, even with header chrome', () => {
    render(<NoteList {...baseProps({ emptyKind: 'downloading' })} />)
    expect(screen.getByText('Getting your notes…')).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toBeInTheDocument()
  })

  it('shows the genuinely-empty state with a write-first-note action', () => {
    const onNewNote = vi.fn()
    render(<NoteList {...baseProps({ onNewNote, emptyKind: 'empty' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Write your first note' }))
    expect(onNewNote).toHaveBeenCalled()
  })

  it('shows no-results when the caller says the query matches nothing', () => {
    render(<NoteList {...baseProps({ query: 'xyz', emptyKind: 'no-results' })} />)
    expect(screen.getByText('No notes match "xyz"')).toBeInTheDocument()
  })

  it('shows the trash-empty state in trash view distinct from the notes-empty state', () => {
    render(<NoteList {...baseProps({ view: 'trash' })} />)
    expect(screen.getByText('Trash is empty.')).toBeInTheDocument()
  })

  it('trash row shows a "deleted" relative-time meta line', () => {
    const row = makeRow({ title: 'Gone', deletedAt: Date.now() - 60_000 })
    render(<NoteList {...baseProps({ view: 'trash', notes: [row] })} />)
    expect(screen.getByText(/^deleted /)).toBeInTheDocument()
  })

  it('renders the outbox dot for a dirty row and not for a clean one', () => {
    const dirty = makeRow({ title: 'Dirty', pendingRev: asRev('p1') })
    const clean = makeRow({ title: 'Clean' })
    const { container } = render(<NoteList {...baseProps({ notes: [dirty, clean] })} />)
    expect(container.querySelectorAll('.outbox-dot')).toHaveLength(1)
  })

  it('a Default-titled row is rendered muted, with no icon or text mark', () => {
    const defaultRow = makeRow({ title: 'Untitled Note 1', body: '', titleIsCustom: false })
    render(<NoteList {...baseProps({ notes: [defaultRow] })} />)
    const row = screen.getByRole('button', { name: 'Untitled Note 1' })
    expect(row.querySelector('.row-title--muted')).toBeInTheDocument()
  })

  it('Sync Now has an accessible name and calls onSyncNow, always enabled', () => {
    const onSyncNow = vi.fn()
    render(<NoteList {...baseProps({ onSyncNow })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    expect(onSyncNow).toHaveBeenCalled()
  })

  it('opens the overflow menu and shows Trash, Auto sync and sign-out items', () => {
    render(<NoteList {...baseProps({ userEmail: 'me@example.com' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.getByRole('menuitem', { name: 'Trash' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: 'Auto sync' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'me@example.com · Sign out' })).toBeInTheDocument()
  })

  it('overflow menu flips to "Back to notes" while in trash view', () => {
    render(<NoteList {...baseProps({ view: 'trash' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.getByRole('menuitem', { name: 'Back to notes' })).toBeInTheDocument()
  })

  it('Auto sync menu item reflects and toggles state', () => {
    const onToggleAutoSync = vi.fn()
    render(<NoteList {...baseProps({ autoSync: false, onToggleAutoSync })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    const item = screen.getByRole('menuitemcheckbox', { name: 'Auto sync' })
    expect(item).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(item)
    expect(onToggleAutoSync).toHaveBeenCalled()
  })

  it('search field placeholder differs between notes and trash views', () => {
    const { rerender } = render(<NoteList {...baseProps()} />)
    expect(screen.getByRole('searchbox', { name: 'Search notes' })).toBeInTheDocument()
    rerender(<NoteList {...baseProps({ view: 'trash' })} />)
    expect(screen.getByRole('searchbox', { name: 'Search trash' })).toBeInTheDocument()
  })
})
