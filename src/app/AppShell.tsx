// src/app/AppShell.tsx
// 05-screens.md §1. The signed-in app. `App` gates on auth and hands this a running `Session`
// (session.ts): the uid's open mirror, its corpus, the shared write lock and the engine's
// triggers. This component never opens storage and reaches sync/ only through the corpus (ESLint).
//
// Breakpoint is a CSS media query (index.css), not JS state: both the list pane and the detail
// pane are ALWAYS mounted, at every viewport width. On a narrow viewport, CSS hides whichever one
// isn't the "current phone screen" (`.shell--note-open` / `.shell--list-open`, toggled by whether
// a Note is open) — nothing under either pane is ever unmounted by a resize.

import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { asNoteId, asRev } from '../domain/note'
import type { NoteId } from '../domain/note'
import { listView, trashView } from '../domain/projection'
import { nextUntitledN } from '../domain/title'
import type { RedirectEvent } from '../sync/corpus'
import type { Session } from '../session'
import { attachLifecycleFlush, onBecameVisible } from '../platform/lifecycle'
import { getAutoSync, setAutoSync as persistAutoSync } from '../platform/prefs'
import { useCorpus } from './useCorpus'
import { useNote } from './useNote'
import { useOutboxCount } from './useOutboxCount'
import { commitCreate, createSaveQueue } from './saveNote'
import type { SaveNoteDeps } from './saveNote'
import { NoteList } from './NoteList'
import type { EmptyStateKind } from './EmptyStates'
import { Editor } from './Editor'
import type { ConflictBanner } from './Editor'
import { SyncStrip } from './SyncStrip'

const CONFLICT_TEXT =
  "This note was edited on another device too. You're still in your version — the other one is kept separately."

/** The part of a Session the shell uses. */
export type ShellSession = Pick<Session, 'store' | 'corpus' | 'status' | 'exclusive' | 'wake' | 'syncNow'>

export interface AppShellProps {
  session: ShellSession
  userEmail: string
  /** Called once every typed change has reached the mirror. The caller closes the session, then
   *  signs out (Designer's amendment 2: flush → close → signOut). */
  onSignOut: () => void
}

export function AppShell({ session, userEmail, onSignOut }: AppShellProps) {
  const { corpus } = session
  // One save path per mounted shell. `useState`'s lazy initializer, not a ref: reading `.current`
  // during render is disallowed (react-hooks/refs).
  const [saveDeps] = useState<SaveNoteDeps>(() => ({
    store: session.store,
    corpus,
    exclusive: session.exclusive,
    now: () => Date.now(),
    mintRev: () => asRev(crypto.randomUUID()),
    onCommitted: () => session.wake(),
  }))
  const [saveQueue] = useState(() => createSaveQueue(saveDeps))
  useEffect(() => () => saveQueue.dispose(), [saveQueue])

  const [view, setView] = useState<'notes' | 'trash'>('notes')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<NoteId | null>(null)
  const [switchToken, setSwitchToken] = useState(0)
  /** Bumped when the open Note is re-seeded from a remote edit: the Editor remounts on it. */
  const [seedToken, setSeedToken] = useState(0)
  const [refocus, setRefocus] = useState<'body' | 'title' | null>(null)
  const [pendingFocusId, setPendingFocusId] = useState<NoteId | null>(null)
  const [autoSync, setAutoSyncState] = useState(getAutoSync)
  const [banner, setBanner] = useState<ConflictBanner | null>(null)
  const status = useSyncExternalStore(session.status.subscribe, session.status.getSnapshot)

  // Android backgrounds this app far more than it closes it — flush every pending debounce on
  // any of the three "the app might disappear now" signals.
  useEffect(() => attachLifecycleFlush(() => saveQueue.flush()), [saveQueue])
  // Architecture's push triggers: `visibilitychange → visible` wakes the Outbox.
  useEffect(() => onBecameVisible(() => session.wake()), [session])

  // 05-screens.md §9: the redirect updates the URL via replaceState, never pushState, and does
  // not touch the corpus a second time — the engine already published both rows in its section.
  // Deliberately does NOT bump `switchToken`: Editor stays mounted through a redirect, which is
  // what lets its uncontrolled textarea preserve value/selection/scroll with no special-casing.
  // The save queue re-keys its buffer itself (it subscribes to the same event).
  useEffect(
    () =>
      corpus.subscribeRedirect((event: RedirectEvent) => {
        setOpenId((current) => {
          if (current !== event.from) return current
          history.replaceState({ noteId: event.to }, '')
          return event.to
        })
        setBanner({ noteId: event.to, text: CONFLICT_TEXT })
      }),
    [corpus],
  )

  // Phone back-button support for the pushState navigations below. A popstate is a navigation
  // to a different Note, so it remounts the Editor exactly as a click does. Without the new
  // `switchToken` the uncontrolled textarea kept the previous Note's text under the new Note's
  // id, and the next keystroke wrote it there (found at step 7).
  useEffect(() => {
    function onPopState(event: PopStateEvent): void {
      const state = event.state as { noteId?: NoteId } | null
      setOpenId(state?.noteId ?? null)
      setSwitchToken((t) => t + 1)
      setPendingFocusId(null)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const rows = useCorpus(corpus)
  const pendingCount = useOutboxCount(corpus)
  const openNote = useNote(corpus, openId)

  // 02 amendment 2026-09-21, rule 1a: `base` is the row the Editor seeded its fields from. A
  // layout effect on the Editor's mount keys, reading the same `openNote` its defaultValue did.
  useLayoutEffect(() => {
    if (openNote !== undefined) saveQueue.seed(openNote)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveQueue, switchToken, seedToken, openNote?.id])

  // Rule 5 + UI/UX (05-screens, Editor): a remote edit to the open, idle Note re-seeds it
  // silently, as a remount — caret and scroll to the top, focus kept in the field that had it.
  // `reseed` refuses whenever anything the user typed is not yet in the mirror.
  // A LAYOUT effect, not a passive one (mathematician's review, 2026-09-21): `reseed` moves the
  // queue's base at once, so the remount must land in the same task. A passive effect left a gap
  // where the old textarea's next keystroke committed the old text as an ordinary edit on the
  // new base — a clean overwrite of the other device. Same shape as the step-6 focus race.
  useLayoutEffect(() => {
    if (openNote === undefined || !saveQueue.reseed(openNote.id)) return
    const label = document.activeElement?.getAttribute('aria-label')
    // Deliberately setState in an effect: the remount must follow a corpus change the queue has
    // just judged safe, which only an effect over `openNote` can observe.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRefocus(label === 'Note body' ? 'body' : label === 'Title' ? 'title' : null)
    setSeedToken((t) => t + 1)
  }, [saveQueue, openNote])

  const listRows = useMemo(() => listView(rows.values(), query), [rows, query])
  const trashRows = useMemo(() => trashView(rows.values()), [rows])
  const activeRows = view === 'notes' ? listRows : trashRows

  const untitledPreviewN = useMemo(() => nextUntitledN([...rows.values()].map((r) => r.title)), [rows])

  // The four first-load states (03, 05-screens §6): downloading, downloading with no connection,
  // genuinely empty, and — a returning device — none at all, because the stamp is already set.
  // Trash's own empty state (§8) is NOT part of this union; NoteList renders it locally.
  const emptyKind: Exclude<EmptyStateKind, 'signin-offline'> | null = useMemo(() => {
    if (status.initialSyncCompletedAt === null) {
      return status.waitingForConnection ? 'downloading-offline' : 'downloading'
    }
    if (query.trim() !== '') return activeRows.length === 0 ? 'no-results' : null
    if (view === 'notes' && activeRows.length === 0) return 'empty'
    return null
  }, [status, query, activeRows, view])

  // Only the currently open Note's redirect banner is shown, and only until dismissed — a
  // dismissed banner must stay dismissed even though `conflictOf` remains true forever (§9).
  const editorBanner: ConflictBanner | null =
    banner !== null && openNote !== undefined && banner.noteId === openNote.id ? banner : null

  // Every navigation clears `pendingFocusId` unless it's explicitly the just-created Note's own
  // navigation — set and cleared in the same event handler (never in an effect), so a later
  // reselect of an older Note never wrongly re-focuses its body via a stale leftover value.
  function navigateTo(id: NoteId | null, opts: { justCreated?: boolean } = {}): void {
    setOpenId(id)
    setSwitchToken((t) => t + 1)
    setRefocus(null)
    setPendingFocusId(opts.justCreated === true && id !== null ? id : null)
    history.pushState({ noteId: id }, '')
  }

  function handleNewNote(): void {
    void (async () => {
      const id = asNoteId(crypto.randomUUID())
      try {
        const row = await commitCreate(saveDeps, id, { title: '', titleIsCustom: false, body: '' })
        setView('notes')
        navigateTo(row.id, { justCreated: true })
      } catch (err) {
        // Same policy as the save queue: a failed local write is loud in the console and never
        // an unhandled rejection. Nothing was written, nothing is lost (the Note had no content
        // yet), and the next tap retries. QA found this at step 6.
        console.error('AppShell: creating a Note in the local mirror failed', err)
      }
    })()
  }

  // Every handler says ONLY what it changed. The save queue merges that into the open Note's
  // buffer, so no handler can revert a field it didn't touch — not the title, and not the latch.
  function handleTitleInput(value: string): void {
    if (openNote === undefined) return
    // Any keystroke here latches the title permanently — there is no escape hatch (05-screens §5).
    saveQueue.schedule(openNote.id, { title: value, titleIsCustom: true })
  }

  function handleBodyInput(value: string): void {
    if (openNote === undefined) return
    saveQueue.schedule(openNote.id, { body: value })
  }

  function handleDelete(): void {
    if (openNote === undefined) return
    saveQueue.schedule(openNote.id, { deletedAt: Date.now() })
    saveQueue.flush(openNote.id)
  }

  function handleRestore(): void {
    if (openNote === undefined) return
    saveQueue.schedule(openNote.id, { deletedAt: null })
    saveQueue.flush(openNote.id)
  }

  function handleToggleTrash(): void {
    setView((v) => (v === 'notes' ? 'trash' : 'notes'))
    setQuery('')
  }

  function handleToggleAutoSync(): void {
    const next = !autoSync
    persistAutoSync(next)
    setAutoSyncState(next)
    // Turning it on: whatever waited in the Outbox goes now, not on the next edit.
    if (next) session.wake()
  }

  // `Sync Now` means "send what I've written": the debounce is flushed into the mirror first.
  function handleSyncNow(): void {
    saveQueue.flush()
    void saveQueue.settled().then(() => session.syncNow())
  }

  function handleSignOut(): void {
    saveQueue.flush()
    void saveQueue.settled().then(onSignOut)
  }

  return (
    <div className={`shell ${openId !== null ? 'shell--note-open' : 'shell--list-open'}`}>
      <div className="pane-list">
        <NoteList
          notes={activeRows}
          view={view}
          activeId={openId}
          query={query}
          onQueryChange={setQuery}
          onSelect={navigateTo}
          onNewNote={handleNewNote}
          autoSync={autoSync}
          onToggleAutoSync={handleToggleAutoSync}
          onSyncNow={handleSyncNow}
          onToggleTrash={handleToggleTrash}
          userEmail={userEmail}
          onSignOut={handleSignOut}
          emptyKind={emptyKind}
        />
      </div>
      <div className="pane-detail">
        {openNote ? (
          <Editor
            key={`${switchToken}:${seedToken}`}
            note={openNote}
            untitledPreviewN={untitledPreviewN}
            onTitleInput={handleTitleInput}
            onBodyInput={handleBodyInput}
            onDelete={handleDelete}
            onRestore={handleRestore}
            onBack={() => navigateTo(null)}
            banner={editorBanner}
            onDismissBanner={() => setBanner(null)}
            autoFocusBody={pendingFocusId === openNote.id}
            refocus={refocus}
          />
        ) : (
          <div className="pick-a-note">Select a note, or write a new one.</div>
        )}
      </div>
      <SyncStrip
        pendingCount={pendingCount}
        autoSync={autoSync}
        persistDenied={status.persistDenied}
        onSyncNow={handleSyncNow}
      />
    </div>
  )
}
