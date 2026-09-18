// src/app/useCorpus.ts
// `Corpus`'s React surface: `useSyncExternalStore` over its own subscribe + snapshot.

import { useSyncExternalStore } from 'react'
import type { LocalNote, NoteId } from '../domain/note'
import type { Corpus } from '../sync/corpus'

export function useCorpus(corpus: Corpus): ReadonlyMap<NoteId, LocalNote> {
  return useSyncExternalStore(corpus.subscribe, corpus.getRows, corpus.getRows)
}
