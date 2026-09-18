// src/app/EmptyStates.tsx — 05-screens.md §6.
// Selection of `kind` is a pure UI fact decided by the caller (initialSyncCompletedAt + corpus
// emptiness + query) — this component does not sniff the network or the store itself.

export type EmptyStateKind =
  | 'downloading'
  | 'downloading-offline'
  | 'empty'
  | 'no-results'
  | 'signin-offline'

export interface EmptyStatesProps {
  kind: EmptyStateKind
  query?: string
  onWriteFirstNote?: () => void
  onRetry?: () => void
}

export function EmptyStates({ kind, query, onWriteFirstNote, onRetry }: EmptyStatesProps) {
  switch (kind) {
    case 'downloading':
      return (
        <div className="empty-state" data-testid="empty-downloading">
          <p>Getting your notes…</p>
          <p>This device is downloading your notes for the first time.</p>
          <div className="skeleton" aria-hidden="true">
            <div className="skeleton-row" />
            <div className="skeleton-row" />
            <div className="skeleton-row" />
          </div>
        </div>
      )

    case 'downloading-offline':
      return (
        <div className="empty-state" data-testid="empty-downloading-offline">
          <p>Waiting for a connection.</p>
          <p>This device hasn&apos;t downloaded your notes yet.</p>
        </div>
      )

    case 'empty':
      return (
        <div className="empty-state" data-testid="empty-empty">
          <p>No notes yet.</p>
          <p>Everything you write is saved on this device first, then synced.</p>
          <button className="primary" onClick={onWriteFirstNote}>
            Write your first note
          </button>
        </div>
      )

    case 'no-results':
      return (
        <div className="empty-state" data-testid="empty-no-results">
          <p>No notes match &quot;{query}&quot;</p>
          <p>Search looks at titles and note text.</p>
        </div>
      )

    case 'signin-offline':
      // Rendered under the `Continue with Google` button on `SignIn`, not inside `NoteList` —
      // this state precedes having a corpus at all (05-screens.md §6, state 5).
      return (
        <p role="alert" data-testid="empty-signin-offline">
          Can&apos;t reach Google to sign in. Check your connection and try again — nothing is
          lost.
          {onRetry && (
            <>
              {' '}
              <button onClick={onRetry}>Try again</button>
            </>
          )}
        </p>
      )
  }
}
