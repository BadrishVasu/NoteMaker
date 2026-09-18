// src/app/useNote.ts
// One Note's React surface: stable while that Note is untouched, even as others change,
// because `Corpus.getRow` returns the same object reference until that row itself is written.

import { useSyncExternalStore } from 'react'
import type { LocalNote, NoteId } from '../domain/note'
import type { Corpus } from '../sync/corpus'

export function useNote(corpus: Corpus, id: NoteId | null): LocalNote | undefined {
  return useSyncExternalStore(
    corpus.subscribe,
    () => (id === null ? undefined : corpus.getRow(id)),
    () => (id === null ? undefined : corpus.getRow(id)),
  )
}
