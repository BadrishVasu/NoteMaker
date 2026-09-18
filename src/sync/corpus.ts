// src/sync/corpus.ts
// The UI's single read surface. Ticket 03 keeps the whole corpus in memory; this is where it
// lives in the tab, and it is the ONLY thing under `sync/` that a React component may import.
//
// Shape, ratified in architecture.md ("Decisions I had to make" #1, builder's amendment):
// a `Map<NoteId, LocalNote>` of immutable rows with **stable identity**, plus a version counter,
// read through `useSyncExternalStore`. Not a store library — one map and one subscribe.
//
// The identity rule is the whole design and it is easy to break by accident:
//
//   * a row object is never mutated; a change replaces it
//   * a row that did not change keeps the SAME object across a batch
//   * the map is copy-on-write, so `getRows()` is itself a valid React snapshot
//
// Without it, a single whole-corpus snapshot re-renders every list row on every keystroke, which
// at ticket 03's ~2,000-Note tripwire is visible jank while typing.

import type { LocalNote, NoteId, RowWrite } from '../domain/note'

/** 02: when reconciliation moves this device's text to a Conflict copy, the editor follows the
 *  **text**. The corpus says which id the content moved to; `Editor` does the `replaceState`. */
export interface RedirectEvent {
  from: NoteId
  to: NoteId
}

export interface Corpus {
  /** React snapshot for anything that renders a list. Referentially stable until a change. */
  getRows(): ReadonlyMap<NoteId, LocalNote>
  /** React snapshot for one Note. Stable while that Note is untouched, even as others change. */
  getRow(id: NoteId): LocalNote | undefined
  /** Changes exactly when the corpus does. Diagnostics and tests; not needed to render. */
  getVersion(): number
  subscribe(listener: () => void): () => void

  /** The whole corpus, from the store at open. One notification. */
  replaceAll(rows: Iterable<LocalNote>): void
  /** The `RowWrite[]` a store transaction just committed. One notification for the batch. */
  applyWrites(writes: readonly RowWrite[]): void

  subscribeRedirect(listener: (event: RedirectEvent) => void): () => void
  /** Called by the engine AFTER both rows are in the corpus. See the ordering note below. */
  redirect(from: NoteId, to: NoteId): void
}

/** Runs every listener even if one throws: a component that explodes mid-notify must not silently
 *  freeze every other subscriber, which would present as a dead app with no error anywhere. */
function notifyAll<T>(listeners: Iterable<(arg: T) => void>, arg: T): void {
  for (const listener of [...listeners]) {
    try {
      listener(arg)
    } catch (err) {
      console.error('corpus: a subscriber threw', err)
    }
  }
}

export function createCorpus(): Corpus {
  let rows: ReadonlyMap<NoteId, LocalNote> = new Map()
  let version = 0
  const listeners = new Set<() => void>()
  const redirectListeners = new Set<(event: RedirectEvent) => void>()

  /** Publishes the new map, then notifies. Never the other way round: a listener that reads the
   *  corpus during notification must see the state it is being told about. */
  const commit = (next: Map<NoteId, LocalNote>): void => {
    rows = next
    version += 1
    notifyAll(listeners, undefined)
  }

  return {
    getRows: () => rows,
    getRow: (id) => rows.get(id),
    getVersion: () => version,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    replaceAll(next) {
      commit(new Map([...next].map((row) => [row.id, row])))
    },

    applyWrites(writes) {
      // Copy-on-write, and only when something actually changes. A no-op batch — a delete of a
      // row that is already gone, or an empty `RowWrite[]` from a pure function that decided to
      // do nothing — must not bump the version, or every such snapshot re-renders the app.
      let next: Map<NoteId, LocalNote> | null = null
      for (const write of writes) {
        if (write.op === 'delete') {
          if (!rows.has(write.id)) continue
          next ??= new Map(rows)
          next.delete(write.id)
        } else {
          if (rows.get(write.row.id) === write.row) continue
          next ??= new Map(rows)
          next.set(write.row.id, write.row)
        }
      }
      if (next !== null) commit(next)
    },

    subscribeRedirect(listener) {
      redirectListeners.add(listener)
      return () => {
        redirectListeners.delete(listener)
      }
    },

    redirect(from, to) {
      // Deliberately NOT a corpus notification. A redirect is a fact about which document the
      // open editor is now editing; the rows themselves were already delivered by `applyWrites`
      // in the same turn. Firing both would re-render the list during the swap, and 05's hard
      // rule is that not one character on screen changes.
      notifyAll(redirectListeners, { from, to })
    },
  }
}
