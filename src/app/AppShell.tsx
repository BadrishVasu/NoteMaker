// src/app/AppShell.tsx
// 05-screens.md §1. The root component. Auth is step 7 (build brief): this shell opens straight
// onto the list against a fixed local uid (`local`), so the IndexedDB database name is
// `notemaker-local`. Step 7 swaps that constant for the signed-in uid and mounts `SignIn` in
// front of this component — everything else here is unaffected.
//
// Breakpoint is a CSS media query (index.css), not JS state: both the list pane and the detail
// pane are ALWAYS mounted, at every viewport width. On a narrow viewport, CSS hides whichever one
// isn't the "current phone screen" (`.shell--note-open` / `.shell--list-open`, toggled by whether
// a Note is open) — nothing under either pane is ever unmounted by a resize.

import { useEffect, useMemo, useRef, useState } from 'react'
import { asNoteId, asRev } from '../domain/note'
import type { NoteId } from '../domain/note'
import { listView, trashView } from '../domain/projection'
import { nextUntitledN } from '../domain/title'
import { createCorpus } from '../sync/corpus'
import type { Corpus, RedirectEvent } from '../sync/corpus'
import { openIdbNoteStore } from '../store/idbNoteStore'
import type { NoteStore } from '../store/noteStore'
import { attachLifecycleFlush } from '../platform/lifecycle'
import { getAutoSync, setAutoSync as persistAutoSync } from '../platform/prefs'
import { useCorpus } from './useCorpus'
import { useNote } from './useNote'
import { useOutboxCount } from './useOutboxCount'
import { commitCreate, createSaveQueue } from './saveNote'
import type { SaveNoteDeps, SaveQueue } from './saveNote'
import { maybeSeed } from './devSeed'
import { NoteList } from './NoteList'
import type { EmptyStateKind } from './EmptyStates'
import { Editor } from './Editor'
import type { ConflictBanner } from './Editor'
import { SyncStrip } from './SyncStrip'

// Step 7 seam: replaced by the signed-in user's uid and email once auth lands.
const LOCAL_UID = 'local'
const PLACEHOLDER_USER_EMAIL = 'this device (not signed in yet)'

const CONFLICT_TEXT =
  "This note was edited on another device too. You're still in your version — the other one is kept separately."

export interface AppShellProps {
  /** The tab's corpus. Step 7's sync engine writes into this same instance (snapshots, and the
   *  conflict redirect), so it is created by whoever wires the engine and passed in. Omitted at
   *  step 6, where the shell is the only writer and makes its own. */
  corpus?: Corpus
}

export function AppShell({ corpus: injected }: AppShellProps = {}) {
  // Lazy-initialized once, for the lifetime of this component. Not a ref: reading `.current`
  // during render is disallowed (react-hooks/refs) — `useState`'s lazy initializer is the
  // idiomatic way to create a single stable instance without one.
  const [corpus] = useState(() => injected ?? createCorpus())
  const saveDepsRef = useRef<SaveNoteDeps | null>(null)
  const saveQueueRef = useRef<SaveQueue | null>(null)

  const [view, setView] = useState<'notes' | 'trash'>('notes')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<NoteId | null>(null)
  const [switchToken, setSwitchToken] = useState(0)
  const [pendingFocusId, setPendingFocusId] = useState<NoteId | null>(null)
  const [autoSync, setAutoSyncState] = useState(getAutoSync)
  const [banner, setBanner] = useState<ConflictBanner | null>(null)
  const [initialSyncCompletedAt, setInitialSyncCompletedAt] = useState<number | null>(null)
  const [persistDenied, setPersistDenied] = useState(false)
  const [bootFailed, setBootFailed] = useState(false)

  // Boot: open the store, seed it (dev-only, opt-in — see devSeed.ts), load the mirror into the
  // corpus, and read the meta keys this screen renders from.
  useEffect(() => {
    let cancelled = false
    let storeHandle: NoteStore | null = null
    void (async () => {
      const store: NoteStore = await openIdbNoteStore(LOCAL_UID)
      storeHandle = store
      if (cancelled) {
        store.close()
        return
      }
      await maybeSeed(store)
      const [rows, initialSync, persistGranted] = await Promise.all([
        store.getAll(),
        store.getMeta('initialSyncCompletedAt'),
        store.getMeta('persistGranted'),
      ])
      if (cancelled) return
      corpus.replaceAll(rows)
      // `initialSyncCompletedAt` is written by ONE thing: sync/engine.ts, on a complete server batch
      // (architecture.md). Step 6 has no engine and touches no network, so the local mirror is the
      // whole truth and the shell treats it as settled — for display, IN MEMORY ONLY. Persisting a
      // stamp here would record a server sync that never happened. (builder, step 6 review)
      // Step 7 swap: delete the `?? Date.now()` fallback; the engine's stamp drives this.
      setInitialSyncCompletedAt(initialSync ?? Date.now())
      setPersistDenied(persistGranted === false)
      const deps: SaveNoteDeps = {
        store,
        corpus,
        now: () => Date.now(),
        mintRev: () => asRev(crypto.randomUUID()),
      }
      saveDepsRef.current = deps
      saveQueueRef.current = createSaveQueue(deps)
    })().catch((err: unknown) => {
      // The mirror could not be opened or read (IndexedDB disabled or blocked). Without this the
      // rejection was unhandled and the shell showed "Getting your notes…" forever. Nothing was
      // written, so nothing is lost; say so, terminally. (builder, step 6 — Frontend's review note)
      console.error('AppShell: opening the local note storage failed', err)
      if (!cancelled) setBootFailed(true)
    })
    return () => {
      cancelled = true
      // Closes the connection this effect opened so a test (or a real navigation away from the
      // app) never leaves an IndexedDB handle open behind it — an open handle blocks a later
      // `deleteDatabase`/version-upgrade indefinitely.
      storeHandle?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Android backgrounds this app far more than it closes it — flush every pending debounce on
  // any of the three "the app might disappear now" signals.
  useEffect(() => attachLifecycleFlush(() => saveQueueRef.current?.flush()), [])

  // 05-screens.md §9: the redirect updates the URL via replaceState, never pushState, and does
  // not touch the corpus a second time — `applyWrites` already delivered both rows this turn.
  // Deliberately does NOT bump `switchToken`: Editor stays mounted through a redirect, which is
  // what lets its uncontrolled textarea preserve value/selection/scroll with no special-casing.
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

  // Phone back-button support for the pushState navigations below.
  useEffect(() => {
    function onPopState(event: PopStateEvent): void {
      const state = event.state as { noteId?: NoteId } | null
      setOpenId(state?.noteId ?? null)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const rows = useCorpus(corpus)
  const pendingCount = useOutboxCount(corpus)
  const openNote = useNote(corpus, openId)

  const listRows = useMemo(() => listView(rows.values(), query), [rows, query])
  const trashRows = useMemo(() => trashView(rows.values()), [rows])
  const activeRows = view === 'notes' ? listRows : trashRows

  const untitledPreviewN = useMemo(() => nextUntitledN([...rows.values()].map((r) => r.title)), [rows])

  // Selection is a pure function of initialSyncCompletedAt + corpus emptiness + query
  // (05-screens.md §6) — computed once here over the whole corpus, not re-derived by NoteList.
  // Trash's own empty state (§8) is NOT part of this union; NoteList renders it locally.
  const emptyKind: Exclude<EmptyStateKind, 'signin-offline'> | null = useMemo(() => {
    if (initialSyncCompletedAt === null) return 'downloading'
    if (query.trim() !== '') return activeRows.length === 0 ? 'no-results' : null
    if (view === 'notes' && activeRows.length === 0) return 'empty'
    return null
  }, [initialSyncCompletedAt, query, activeRows, view])

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
    setPendingFocusId(opts.justCreated === true && id !== null ? id : null)
    history.pushState({ noteId: id }, '')
  }

  function handleNewNote(): void {
    const deps = saveDepsRef.current
    if (deps === null) return
    void (async () => {
      const id = asNoteId(crypto.randomUUID())
      try {
        const row = await commitCreate(deps, id, { title: '', titleIsCustom: false, body: '' })
        setView('notes')
        navigateTo(row.id, { justCreated: true })
      } catch (err) {
        // Same policy as the save queue's writeNow: a failed local write is loud in the console
        // and never an unhandled rejection. Nothing was written, nothing is lost (the Note had no
        // content yet), and the next tap retries. QA found this at step 6.
        console.error('AppShell: creating a Note in the local mirror failed', err)
      }
    })()
  }

  // Every handler says ONLY what it changed. The save queue merges that onto the freshest
  // content it knows of (pending patch → in-flight commit → live corpus row), so no handler can
  // revert a field it didn't touch — not the title, and not the latch. See saveNote.ts.
  function handleTitleInput(value: string): void {
    if (openNote === undefined || saveQueueRef.current === null) return
    // Any keystroke here latches the title permanently — there is no escape hatch (05-screens §5).
    saveQueueRef.current.schedule(openNote.id, { title: value, titleIsCustom: true })
  }

  function handleBodyInput(value: string): void {
    if (openNote === undefined || saveQueueRef.current === null) return
    saveQueueRef.current.schedule(openNote.id, { body: value })
  }

  function handleDelete(): void {
    if (openNote === undefined || saveQueueRef.current === null) return
    saveQueueRef.current.schedule(openNote.id, { deletedAt: Date.now() })
    saveQueueRef.current.flush(openNote.id)
  }

  function handleRestore(): void {
    if (openNote === undefined || saveQueueRef.current === null) return
    saveQueueRef.current.schedule(openNote.id, { deletedAt: null })
    saveQueueRef.current.flush(openNote.id)
  }

  function handleToggleTrash(): void {
    setView((v) => (v === 'notes' ? 'trash' : 'notes'))
    setQuery('')
  }

  function handleToggleAutoSync(): void {
    setAutoSyncState((prev) => {
      const next = !prev
      persistAutoSync(next)
      return next
    })
  }

  // No sync/engine.ts exists at step 6 (build brief's seam) — a harmless, honest no-op today.
  function handleSyncNow(): void {
    /* step 7 seam */
  }

  if (bootFailed) {
    // Copy by builder, pending UI/UX review — 05-screens.md has no state for this.
    return (
      <div className="boot-failed" role="alert">
        Can't open this device's note storage. Nothing has been changed — try reloading.
      </div>
    )
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
          userEmail={PLACEHOLDER_USER_EMAIL}
          onSignOut={() => {
            /* step 7 seam: no auth session exists yet to sign out of. */
          }}
          emptyKind={emptyKind}
        />
      </div>
      <div className="pane-detail">
        {openNote ? (
          <Editor
            key={switchToken}
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
          />
        ) : (
          <div className="pick-a-note">Select a note, or write a new one.</div>
        )}
      </div>
      <SyncStrip
        pendingCount={pendingCount}
        autoSync={autoSync}
        persistDenied={persistDenied}
        onSyncNow={handleSyncNow}
      />
    </div>
  )
}
