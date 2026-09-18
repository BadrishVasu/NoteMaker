// src/app/devSeed.ts
// Step 6 is "usable against a seeded store" (build brief). Guarded twice, deliberately: this
// must never run in a production build (`import.meta.env.DEV`) and must never run just because a
// dev server happened to be open (`?seed` in the URL) — an opt-in the developer types, not a
// default a stray reload triggers. Seeds only when the mirror is genuinely empty, so it never
// clobbers real (dev) data on a second load.

import { asNoteId, asRev } from '../domain/note'
import type { LocalNote } from '../domain/note'
import type { NoteStore } from '../store/noteStore'

function seedRow(id: string, over: Partial<LocalNote>, now: number): LocalNote {
  return {
    id: asNoteId(id),
    title: 'Untitled Note 1',
    titleIsCustom: false,
    body: '',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    rev: asRev(`seed-${id}`),
    baseRev: asRev(`seed-${id}`),
    pendingRev: null,
    baseContent: null,
    ...over,
  }
}

/**
 * A handful of Notes exercising the states the spec gives copy for: a Derived title, a Custom
 * title, a Default title (empty body), one sitting in the Outbox, one in the Trash.
 */
export function buildSeedRows(now: number): LocalNote[] {
  return [
    seedRow(
      'seed-derived',
      { title: 'Grocery list', body: 'Grocery list\nMilk\nEggs\nBread', updatedAt: now - 60_000 },
      now,
    ),
    seedRow(
      'seed-custom',
      {
        title: 'Q3 project plan',
        titleIsCustom: true,
        body: 'Kickoff is Monday.',
        updatedAt: now - 120_000,
      },
      now,
    ),
    seedRow('seed-default', { title: 'Untitled Note 2', body: '', updatedAt: now - 180_000 }, now),
    seedRow(
      'seed-outbox',
      {
        title: 'Draft in progress',
        body: 'Draft in progress\nStill writing this one…',
        updatedAt: now - 30_000,
        rev: asRev('seed-outbox-pending'),
        baseRev: asRev('seed-outbox-base'),
        pendingRev: asRev('seed-outbox-pending'),
        baseContent: {
          title: 'Draft in progress',
          titleIsCustom: false,
          body: 'Draft in progress\nStill writing this one…',
        },
      },
      now,
    ),
    seedRow(
      'seed-trash',
      {
        title: 'Old scratch note',
        body: 'Old scratch note\nNo longer needed.',
        deletedAt: now - 86_400_000,
        updatedAt: now - 86_400_000,
      },
      now,
    ),
  ]
}

function seedRequested(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('seed')
}

/**
 * Seeds the given store with `buildSeedRows()` when: this is a dev build, `?seed` is present in
 * the URL, and the mirror is currently empty. A no-op in every other case, including production
 * builds where `import.meta.env.DEV` is statically `false` and this whole branch is dead code.
 */
export async function maybeSeed(store: NoteStore, now: () => number = Date.now): Promise<void> {
  if (!import.meta.env.DEV) return
  if (!seedRequested()) return

  await store.runInTransaction(async (tx) => {
    const existing = await tx.getAll()
    if (existing.length > 0) return
    const rows = buildSeedRows(now())
    for (const row of rows) await tx.put(row)
    // Rows only. `initialSyncCompletedAt` has one writer, sync/engine.ts, on a complete server
    // batch — a seed is not a sync. AppShell treats the step-6 mirror as settled in memory.
  })
}
