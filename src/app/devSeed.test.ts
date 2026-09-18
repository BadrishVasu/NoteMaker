import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildSeedRows, maybeSeed } from './devSeed'
import { deleteMemoryNoteStore, openMemoryNoteStore } from '../store/memoryNoteStore'
import type { NoteStore } from '../store/noteStore'

const UID = 'dev-seed-test'

describe('devSeed', () => {
  let store: NoteStore

  beforeEach(async () => {
    store = await openMemoryNoteStore(UID)
    history.pushState(null, '', '/')
  })

  afterEach(async () => {
    await deleteMemoryNoteStore(UID)
    history.pushState(null, '', '/')
  })

  describe('buildSeedRows', () => {
    it('produces a Derived, a Custom, a Default, an Outbox and a Trash row', () => {
      const rows = buildSeedRows(1_000_000)
      expect(rows).toHaveLength(5)
      const outbox = rows.find((r) => r.pendingRev !== null)
      expect(outbox?.baseContent).not.toBeNull()
      const trashed = rows.find((r) => r.deletedAt !== null)
      expect(trashed).toBeDefined()
      const custom = rows.find((r) => r.titleIsCustom)
      expect(custom).toBeDefined()
      const derived = rows.find((r) => !r.titleIsCustom && r.body !== '')
      expect(derived).toBeDefined()
      const defaultTitled = rows.find((r) => !r.titleIsCustom && r.body === '')
      expect(defaultTitled).toBeDefined()
    })
  })

  describe('maybeSeed', () => {
    it('does nothing when ?seed is absent from the URL', async () => {
      await maybeSeed(store)
      expect(await store.getAll()).toHaveLength(0)
    })

    it('seeds the store when ?seed is present and the mirror is empty', async () => {
      history.pushState(null, '', '/?seed')
      await maybeSeed(store)
      const rows = await store.getAll()
      expect(rows).toHaveLength(5)
    })

    it('seeds rows only — it does not stamp initialSyncCompletedAt, which only the engine writes', async () => {
      history.pushState(null, '', '/?seed')
      await maybeSeed(store)
      expect(await store.getMeta('initialSyncCompletedAt')).toBeUndefined()
    })

    it('does not reseed (or duplicate) when the mirror already has rows', async () => {
      history.pushState(null, '', '/?seed')
      await maybeSeed(store)
      await maybeSeed(store)
      expect(await store.getAll()).toHaveLength(5)
    })
  })
})
