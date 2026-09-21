// src/platform/persistStorage.ts
// Ticket 03: without `navigator.storage.persist()` IndexedDB is best-effort and the browser may
// evict it under disk pressure — and unpushed Outbox edits live only there. This is the browser
// edge: it answers "is this origin's storage persistent now?" and never throws. When to call it
// (first sign-in, then once per open while denied) and recording the answer in
// `meta.persistGranted` belong to session.ts.

type StorageLike = Pick<StorageManager, 'persist' | 'persisted'>

export async function requestPersist(
  storage: StorageLike | undefined = typeof navigator === 'undefined' ? undefined : navigator.storage,
): Promise<boolean> {
  if (typeof storage?.persist !== 'function') return false
  try {
    // Already granted: asking again is pointless, and on some browsers it re-runs the heuristic.
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return true
    return await storage.persist()
  } catch {
    // Denied by policy or unavailable in this context. Silent by design (03): no warning the user
    // cannot act on; the SyncStrip's persist-denied state is the one honest signal.
    return false
  }
}
