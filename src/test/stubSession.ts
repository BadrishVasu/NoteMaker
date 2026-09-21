// src/test/stubSession.ts
// A Session with no engine, over a real store and corpus, for the React tests. Lives in test/ so
// app/ tests don't import sync/engine (app/ may not, ESLint) — the shared lock comes from here.

import type { NoteStore } from '../store/noteStore'
import { createCorpus } from '../sync/corpus'
import { createExclusive } from '../sync/engine'
import type { Session, SessionStatus } from '../session'

export interface StubSession extends Session {
  setStatus(patch: Partial<SessionStatus>): void
  wakes: number
  syncNows: number
  closed: boolean
}

export async function stubSession(
  uid: string,
  store: NoteStore,
  status: Partial<SessionStatus> = {},
): Promise<StubSession> {
  const corpus = createCorpus()
  corpus.replaceAll(await store.getAll())
  let snapshot: SessionStatus = {
    initialSyncCompletedAt: 1,
    waitingForConnection: false,
    persistDenied: false,
    ...status,
  }
  const listeners = new Set<() => void>()
  const s: StubSession = {
    uid,
    store,
    corpus,
    exclusive: createExclusive(),
    status: {
      getSnapshot: () => snapshot,
      subscribe: (l) => {
        listeners.add(l)
        return () => listeners.delete(l)
      },
    },
    wakes: 0,
    syncNows: 0,
    closed: false,
    wake: () => void s.wakes++,
    syncNow: () => void s.syncNows++,
    async close() {
      s.closed = true
      store.close()
    },
    setStatus(patch) {
      snapshot = { ...snapshot, ...patch }
      for (const l of [...listeners]) l()
    },
  }
  return s
}
