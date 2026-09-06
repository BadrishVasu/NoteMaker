// src/store/noteStore.ts
// Ticket 03's port. Two implementations, one contract suite (`contract.test.ts`).

import type { DeviceId, LocalNote, NoteId } from '../domain/note'

/**
 * The `meta` object store: key-value, exactly three keys (architecture.md, "The types").
 * A key never written reads as `undefined`; `initialSyncCompletedAt` is typed `| null`
 * as the Designer specified it, but nothing writes null — it is set once and never
 * cleared (03).
 */
export interface MetaShape {
  /** 03: set once, when the first snapshot for this uid has been applied. Empty mirror
   *  plus unset renders *loading*; empty mirror plus set renders the genuine empty state. */
  initialSyncCompletedAt: number | null
  /** Minted once per uid, never rotated (Builder's gap 1, 2026-08-26). */
  deviceId: DeviceId
  /** 03: `navigator.storage.persist()`'s answer, retried silently once per open. */
  persistGranted: boolean
}

export type MetaKey = keyof MetaShape

/** The read/write surface inside a transaction. Spans BOTH object stores: the first
 *  snapshot writes the corpus and sets `initialSyncCompletedAt` in one commit. */
export interface NoteStoreTx {
  getAll(): Promise<LocalNote[]>
  get(id: NoteId): Promise<LocalNote | undefined>
  put(row: LocalNote): Promise<void>
  delete(id: NoteId): Promise<void>
  getMeta<K extends MetaKey>(key: K): Promise<MetaShape[K] | undefined>
  setMeta<K extends MetaKey>(key: K, value: MetaShape[K]): Promise<void>
}

export interface NoteStore extends NoteStoreTx {
  /**
   * Runs `fn` against one transaction over both object stores. Resolves with `fn`'s
   * value; if `fn` throws, every write it made is rolled back and the error rethrown.
   *
   * `fn` must only await this transaction's own operations. Awaiting anything else
   * (a fetch, a timer) lets IndexedDB auto-commit the transaction out from under it.
   */
  runInTransaction<T>(fn: (tx: NoteStoreTx) => Promise<T> | T): Promise<T>
  close(): void
}

/**
 * The row invariant, enforced on every write by both implementations.
 *
 *   `baseContent !== null`  iff  `pendingRev !== null && baseRev !== null`
 *
 * `baseContent` is the content at `baseRev` — the fork point a Conflict copy's
 * `conflictBase` is written from, and 02 states that field cannot be retrofitted.
 * Each side of the biconditional catches one failure, and both are silent until
 * ticket 11 makes them expensive:
 *
 *   - missing when it should be present → a merge that is silently two-way forever
 *   - present when it should be absent  → a stale fork point written into a copy
 *
 * A guard on the object rather than a check on the caller: the leak worth catching is
 * a write path that reasons its way to a wrong row, not one that forgets to assert.
 *
 * **This is a shape check, and it is not the whole property.** Model-checked
 * (02, appendix 3, mathematician, 2026-09-06): the biconditional is implied by the
 * corrected capture rule and is safe to enforce on every write — it will not reject a
 * legitimate row — but it is strictly weaker than what must hold. A row whose
 * `baseContent` is simply the *wrong* content satisfies it; run against the design
 * carrying that defect, it survived ~900k states without firing. The real property,
 * *`baseContent` equals the content this row's `baseRev` was written with*, is a
 * lineage claim about history that a single row cannot answer, so it cannot live here.
 * It is pinned at the reconcile (step 3/4), where a fixture can remember content per
 * rev. Do not let this function's presence be read as covering it.
 *
 * The capture rule itself is an engine rule, not a row-shape rule, and it is stated
 * once, on `features/conflict-sync.md`: `baseContent := the in-flight content` at
 * *every* transition that sets `baseRev := flightRev` while the row stays dirty (four
 * transaction branches plus the conflict-branch outbox-slot migration), and `null`
 * whenever the row goes clean. The earlier two-point version of this comment named one
 * of those branches and was wrong.
 */
export function assertRowInvariant(row: LocalNote): void {
  const shouldHave = row.pendingRev !== null && row.baseRev !== null
  if (shouldHave === (row.baseContent !== null)) return
  throw new Error(
    shouldHave
      ? `NoteStore: row ${row.id} is dirty against baseRev ${String(row.baseRev)} but has no ` +
        `baseContent — the fork point was never captured and cannot be recovered.`
      : `NoteStore: row ${row.id} carries baseContent while pendingRev=${String(row.pendingRev)} ` +
        `and baseRev=${String(row.baseRev)} — a stale fork point that must have been cleared.`,
  )
}
