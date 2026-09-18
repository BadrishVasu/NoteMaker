// src/domain/size.ts
// Pure. Ticket 05, "Body size". Typing is never blocked — it is the *sync* that fails, and it
// fails visibly.

/**
 * ~450 KiB of combined title and body.
 *
 * Corrected 2026-08-26 (builder) from the ~1 MiB that ticket 01 handed over. 1 MiB is Firestore's
 * document cap, and a Note's own body is not the whole document: a Conflict copy under ticket 02
 * carries **its own content plus `conflictBase`, the fork-point content, in one document**. So a
 * 600 KiB Note is fine until the day it conflicts, at which point the copy exceeds the cap, the
 * transaction fails permanently, and the Outbox never drains — with the bottom strip cheerfully
 * telling the user their notes are safe.
 *
 * Since any Note can conflict, the visible threshold has to be the conflict-safe one.
 */
export const SYNC_SIZE_LIMIT_BYTES = 450 * 1024

const utf8 = new TextEncoder()

/** UTF-8 bytes of title + body. Code units would under-count every emoji and every CJK note. */
export const syncSizeBytes = (n: { title: string; body: string }): number =>
  utf8.encode(n.title).length + utf8.encode(n.body).length

export const exceedsSyncLimit = (n: { title: string; body: string }): boolean =>
  syncSizeBytes(n) > SYNC_SIZE_LIMIT_BYTES
