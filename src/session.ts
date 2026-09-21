// src/session.ts — the composition root (architecture.md, "Composition root", Designer,
// 2026-09-21). One signed-in uid's running app: its mirror, its corpus, its engine. It sits above
// every layer because it wires all of them; `main.tsx` is its only value importer, and `app/`
// sees only its types (ESLint).
//
// What it owns:
//   - opening `notemaker-<uid>` and loading the corpus from it;
//   - `persist()` on first sign-in, retried once per open while denied (03), recorded in
//     `meta.persistGranted` — requested, never awaited: a browser prompt must not hold the Notes
//     back (Designer's amendment 1);
//   - the engine, whose committed writes feed the corpus and whose snapshot deliveries drive the
//     first-load states. Snapshot delivery is the connectivity oracle; nothing here reads
//     `navigator.onLine`;
//   - `close()`: stop the engine, let an in-flight push commit, then close the store. The caller
//     flushes its save queue BEFORE calling it and signs out AFTER (Designer's amendment 2).

import type { RowWrite } from './domain/note'
import type { NoteStore } from './store/noteStore'
import { createCorpus } from './sync/corpus'
import type { Corpus } from './sync/corpus'
import { createExclusive, createSyncEngine } from './sync/engine'
import type { Clock, Exclusive, SyncProblem } from './sync/engine'
import type { RemoteGateway } from './sync/remoteGateway'

/** What the UI renders besides the corpus. One snapshot object, `useSyncExternalStore`-shaped. */
export interface SessionStatus {
  /** From the mirror at open, then from the engine. null = this device never completed a sync. */
  initialSyncCompletedAt: number | null
  /** No sync yet, and Firestore has said it is serving from cache: it cannot reach the server. */
  waitingForConnection: boolean
  /** `persist()` answered no (03): the SyncStrip drops its reassurance clause. Unknown is not no. */
  persistDenied: boolean
}

export interface StatusSource {
  getSnapshot(): SessionStatus
  subscribe(listener: () => void): () => void
}

export interface Session {
  readonly uid: string
  readonly store: NoteStore
  readonly corpus: Corpus
  readonly status: StatusSource
  /** The one write lock every mirror write runs under — the engine's commits and the save path's
   *  (02 amendment 2026-09-21, rule 2). */
  readonly exclusive: Exclusive
  /** A local edit was committed to the mirror: push the Outbox (subject to Auto sync). */
  wake(): void
  /** The `Sync Now` button: pushes whatever Auto sync says. */
  syncNow(): void
  close(): Promise<void>
}

export interface SessionDeps {
  openStore(uid: string): Promise<NoteStore>
  gateway: RemoteGateway
  clock: Clock
  autoSync(): boolean
  requestPersist(): Promise<boolean>
  onProblem?(problem: SyncProblem): void
}

export async function openSession(uid: string, deps: SessionDeps): Promise<Session> {
  const store = await deps.openStore(uid)
  try {
    const [rows, stamp, persistGranted] = await Promise.all([
      store.getAll(),
      store.getMeta('initialSyncCompletedAt'),
      store.getMeta('persistGranted'),
    ])
    const corpus = createCorpus()
    corpus.replaceAll(rows)

    let status: SessionStatus = {
      initialSyncCompletedAt: stamp ?? null,
      waitingForConnection: false,
      persistDenied: persistGranted === false,
    }
    const listeners = new Set<() => void>()
    const setStatus = (patch: Partial<SessionStatus>): void => {
      const next = { ...status, ...patch }
      if (
        next.initialSyncCompletedAt === status.initialSyncCompletedAt &&
        next.waitingForConnection === status.waitingForConnection &&
        next.persistDenied === status.persistDenied
      ) {
        return
      }
      status = next
      for (const l of [...listeners]) l()
    }

    let closed = false
    let closing: Promise<void> | null = null
    const exclusive = createExclusive()
    const engine = createSyncEngine({
      exclusive,
      uid,
      store,
      gateway: deps.gateway,
      clock: deps.clock,
      autoSync: deps.autoSync,
      onProblem: (problem) => deps.onProblem?.(problem),
      onWrites: (writes: RowWrite[]) => {
        if (!closed) corpus.applyWrites(writes)
      },
      onRedirect: ({ from, to }) => {
        if (!closed) corpus.redirect(from, to)
      },
      onSnapshot: ({ fromCache, initialSyncCompletedAt }) => {
        if (closed) return
        setStatus({ initialSyncCompletedAt, waitingForConnection: initialSyncCompletedAt === null && fromCache })
      },
    })

    if (persistGranted !== true) {
      void deps.requestPersist().then(async (granted) => {
        if (closed) return
        await store.setMeta('persistGranted', granted)
        setStatus({ persistDenied: !granted })
      }).catch((err: unknown) => {
        // Recording the answer failed (the store closed under us, or quota). The next open asks again.
        console.error('session: recording the persist() answer failed', err)
      })
    }

    await engine.start()

    return {
      uid,
      store,
      corpus,
      exclusive,
      status: {
        getSnapshot: () => status,
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      },
      wake: () => engine.wake(),
      syncNow: () => engine.syncNow(),
      // Idempotent: sign-out and App's effect cleanup may both call it; both get the one close.
      close() {
        closing ??= (async () => {
          await engine.stop()
          closed = true
          listeners.clear()
          store.close()
        })()
        return closing
      },
    }
  } catch (err) {
    store.close()
    throw err
  }
}
