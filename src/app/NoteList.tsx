// src/app/NoteList.tsx — 05-screens.md §2, §6, §8 (TrashView is this component in `view="trash"`).
// Does not sort, does not match — the caller (a projection.ts-backed hook in AppShell) hands
// down an already filtered/sorted `notes` array and decides the empty-state `kind`.

import { useState } from 'react'
import type { LocalNote, NoteId } from '../domain/note'
import { isDefaultTitle } from '../domain/title'
import { SearchField } from './SearchField'
import { EmptyStates, type EmptyStateKind } from './EmptyStates'
import { relativeTime } from './relativeTime'

export interface NoteListProps {
  notes: LocalNote[]
  view: 'notes' | 'trash'
  activeId: NoteId | null
  query: string
  onQueryChange: (s: string) => void
  onSelect: (id: NoteId) => void
  onNewNote: () => void
  autoSync: boolean
  onToggleAutoSync: () => void
  onSyncNow: () => void
  /** Flips between `notes` and `trash`. AppShell owns the side effects (query/openId reset). */
  onToggleTrash: () => void
  onSignOut: () => void
  userEmail: string
  /**
   * Which cold-start/no-results state to show in place of the row list, `null` to show rows.
   * Selection is a pure function of `initialSyncCompletedAt` + corpus emptiness + `query`
   * (05-screens.md §6) — AppShell computes it once over the whole corpus and hands it down,
   * rather than this component re-deriving it from a narrower slice of props. The Trash-empty
   * state (§8) is NOT part of this union — it is Trash-specific and computed locally below.
   */
  emptyKind: Exclude<EmptyStateKind, 'signin-offline'> | null
}

function NoteRow({
  note,
  view,
  active,
  onSelect,
}: {
  note: LocalNote
  view: 'notes' | 'trash'
  active: boolean
  onSelect: (id: NoteId) => void
}) {
  const muted = isDefaultTitle(note)
  const metaText =
    view === 'trash'
      ? `deleted ${relativeTime(note.deletedAt ?? note.updatedAt)}`
      : relativeTime(note.updatedAt)

  return (
    <button
      type="button"
      className="row"
      aria-current={active ? 'true' : undefined}
      onClick={() => onSelect(note.id)}
    >
      {/* The row's accessible name is exactly its visible title — everything else here is
          aria-hidden so a screen reader hears what's on screen, not a longer synthesized name. */}
      <span className={`row-title${muted ? ' row-title--muted' : ''}`}>{note.title}</span>
      <span className="badge-slot" data-testid="conflict-badge-slot" aria-hidden="true" />
      <span className="row-meta" aria-hidden="true">
        {note.pendingRev !== null && <span className="outbox-dot" aria-hidden="true" />}
        {metaText}
      </span>
    </button>
  )
}

export function NoteList({
  notes,
  view,
  activeId,
  query,
  onQueryChange,
  onSelect,
  onNewNote,
  autoSync,
  onToggleAutoSync,
  onSyncNow,
  onToggleTrash,
  onSignOut,
  userEmail,
  emptyKind,
}: NoteListProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  // Trash-specific empty state (05-screens.md §8) — distinct from the shared `emptyKind` union
  // AppShell computes, and only shown once AppShell isn't already showing `downloading`.
  const trashEmpty = emptyKind === null && view === 'trash' && notes.length === 0

  return (
    <div className="note-list">
      <div className="note-list-header">
        <SearchField
          value={query}
          onChange={onQueryChange}
          placeholder={view === 'trash' ? 'Search trash' : 'Search notes'}
        />
        <button type="button" aria-label="Sync now" onClick={onSyncNow}>
          ⟳
        </button>
        <div className="menu-container">
          <button
            type="button"
            aria-label="Menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            ⋮
          </button>
          {menuOpen && (
            <div role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onToggleTrash()
                  setMenuOpen(false)
                }}
              >
                {view === 'trash' ? 'Back to notes' : 'Trash'}
              </button>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={autoSync}
                onClick={() => {
                  onToggleAutoSync()
                  setMenuOpen(false)
                }}
              >
                Auto sync
              </button>
              <p className="menu-helper" aria-disabled="true">
                Off: notes only sync when you tap Sync Now.
              </p>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onSignOut()
                  setMenuOpen(false)
                }}
              >
                {userEmail} · Sign out
              </button>
            </div>
          )}
        </div>
        <button type="button" className="new-note-header" onClick={onNewNote}>
          New note
        </button>
      </div>

      {trashEmpty ? (
        <div className="empty-state" data-testid="empty-trash">
          <p>Trash is empty.</p>
          <p>Deleted notes wait here for 30 days before they&apos;re purged.</p>
        </div>
      ) : emptyKind !== null ? (
        <EmptyStates kind={emptyKind} query={query} onWriteFirstNote={onNewNote} />
      ) : (
        <div className="row-list">
          {notes.map((note) => (
            <NoteRow key={note.id} note={note} view={view} active={note.id === activeId} onSelect={onSelect} />
          ))}
        </div>
      )}

      <button type="button" className="fab" aria-label="New note" onClick={onNewNote}>
        +
      </button>
    </div>
  )
}
