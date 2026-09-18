// src/app/useOutboxCount.ts
// The Outbox is a column over the whole corpus (domain/projection.outboxCount), not a second
// store — a trashed row with a pendingRev counts too, an unpushed delete is a write waiting to
// sync exactly like an unpushed edit.

import { outboxCount } from '../domain/projection'
import { useCorpus } from './useCorpus'
import type { Corpus } from '../sync/corpus'

export function useOutboxCount(corpus: Corpus): number {
  const rows = useCorpus(corpus)
  return outboxCount(rows.values())
}
