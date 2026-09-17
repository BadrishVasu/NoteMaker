// src/domain/note.ts
// Pure. Imports nothing. No I/O, no React, no Firebase, no IndexedDB, no Date.now().
// Every value that a clock or a random source would produce is passed in as an argument.

// ── Identifiers ───────────────────────────────────────────────────────────────
// Branded so that a NoteId cannot be passed where a Rev is expected. Zero runtime
// cost; three casts at the edges. See "Decisions I had to make", #1.

/** A Firestore document id under `users/{uid}/notes`, and the mirror's primary key. */
export type NoteId = string & { readonly __brand: 'NoteId' }

/** 02's opaque identity token. Compared by equality only — never ordered, never parsed. */
export type Rev = string & { readonly __brand: 'Rev' }

/** 8 chars of a `crypto.randomUUID()`, minted once per uid into `meta`, never rotated. */
export type DeviceId = string & { readonly __brand: 'DeviceId' }

export const asNoteId = (s: string): NoteId => s as NoteId
export const asRev = (s: string): Rev => s as Rev
export const asDeviceId = (s: string): DeviceId => s as DeviceId

// ── Content ───────────────────────────────────────────────────────────────────

/**
 * The three fields that constitute a Note's *content* — the unit 02 compares for
 * fast-forward and the unit a merge operates on. One type, used in three places:
 * the wire field `conflictBase`, the local field `baseContent`, and `ServerState`.
 * They are the same thing, so they are the same type.
 */
export interface ForkPoint {
  title: string
  titleIsCustom: boolean
  body: string
}

// ── The wire document ─────────────────────────────────────────────────────────

/**
 * Exactly the nine fields of ticket 01's amended allowlist, and nothing else.
 * The security rules use a closed allowlist, so a tenth field is a *denied write*,
 * which surfaces as a permanently stuck Outbox rather than as an error.
 *
 * `id` is deliberately NOT a field: it is the document key, exactly as `userId` is
 * the path. See `IdentifiedDoc` for the read side.
 */
export interface NoteDoc {
  /** W — never empty; 01's Default title guarantees this from birth. */
  title: string
  /** W — false = Derived, true = Custom. One-way latch, flipped only by the user. */
  titleIsCustom: boolean
  /** W — markdown source. */
  body: string
  /** W — epoch millis, client clock, set once, immutable by rule. */
  createdAt: number
  /** W — epoch millis, client clock, bumped on every edit. A list sort key ONLY:
   *  nothing in the sync mechanism reads it (02 dissolved the clock-skew debt). */
  updatedAt: number
  /** W — Tombstone. `null` = live, millis = in Trash. Explicit null, never absent. */
  deletedAt: number | null
  /** W — 02's identity token. Client-minted before the round trip; equality only. */
  rev: Rev
  /** W, C — the id of the surviving sibling this document is a Conflict copy of.
   *  ABSENT (not null, not undefined) on every ordinary Note. A soft pointer: the
   *  target may be purged or deleted-forever, and ticket 11's UI must tolerate that. */
  conflictOf?: NoteId
  /** W, C — the fork-point content, written at the copy's birth and never updated.
   *  Unrecoverable if not captured here; it is what makes the merge three-way.
   *  May legitimately be absent even when `conflictOf` is present — see #4. */
  conflictBase?: ForkPoint
}

/** How a document travels once its key matters: reads, snapshots, writes. */
export interface IdentifiedDoc {
  id: NoteId
  doc: NoteDoc
}

/** A Conflict copy, narrowed. Our writer always emits both fields; a reader must not
 *  assume that, because the rules deliberately do not require them together. */
export type ConflictCopyDoc = NoteDoc & { conflictOf: NoteId }
export const isConflictCopy = (d: NoteDoc): d is ConflictCopyDoc =>
  d.conflictOf !== undefined

// ── The mirror row ────────────────────────────────────────────────────────────

/**
 * One IndexedDB row in object store `notes` of database `notemaker-<uid>`,
 * keyPath `id`. One row, one atomic put (ticket 03). The Outbox is the subset of
 * rows where `pendingRev !== null` — there is no second store and no `synced` flag.
 */
export interface LocalNote extends NoteDoc {
  /** L — the document key, carried in the row because IndexedDB needs a keyPath. */
  id: NoteId
  /**
   * L — the rev this row's content forked from. `null` for a create that has never
   * landed. May only ever be set to a rev the listener delivered for a CLEAN row,
   * or to a rev this device itself wrote (02 appendix, the corrected invariant).
   */
  baseRev: Rev | null
  /**
   * L — the token this row's current content will be pushed under, minted at
   * EDIT time on every keystroke, in both Auto sync and manual modes.
   * `pendingRev !== null` *is* dirty; it is the snapshot guard's predicate.
   */
  pendingRev: Rev | null
  /**
   * L — the content as it stood at `baseRev`. Non-null exactly while the row is
   * dirty against a real base; `null` on every clean row and on an unlanded create.
   * This is the field the tickets do not have and the conflict branch cannot work
   * without — see "The one thing the tickets were missing" below.
   */
  baseContent: ForkPoint | null
}

/**
 * One `lastServerState` entry. In-memory only, owned by `sync/engine.ts`, never persisted
 * (02 appendix, defect 1).
 *
 * Widened from `ForkPoint & Pick<NoteDoc, 'rev' | 'deletedAt'>` to the whole document —
 * builder, step 3, 2026-09-17. `commitPush` ADOPTS from this entry (defect 1's fix), and an
 * adopted row needs `createdAt`, `updatedAt`, `conflictOf` and `conflictBase` too; the
 * five-field shape would have dropped a copy's `conflictBase` on adopt. The model did not
 * carry timestamps or conflict fields, which is why its shape was narrower.
 */
export type ServerState = NoteDoc

// ── The one serialisation boundary ────────────────────────────────────────────

/**
 * The ONLY way a row becomes a wire document. An explicit pick, never a spread and
 * never a delete: a spread ships whatever local field someone adds next, and the
 * rules deny it. Optional fields are OMITTED, never set to `undefined` — Firestore
 * throws on `undefined`, and `ignoreUndefinedProperties` must stay OFF so that a
 * mistake here is loud instead of a silently dropped field.
 */
export function toNoteDoc(n: LocalNote): NoteDoc {
  const doc: NoteDoc = {
    title: n.title,
    titleIsCustom: n.titleIsCustom,
    body: n.body,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    deletedAt: n.deletedAt,
    rev: n.rev,
  }
  if (n.conflictOf !== undefined) doc.conflictOf = n.conflictOf
  if (n.conflictBase !== undefined) doc.conflictBase = n.conflictBase
  return doc
}

/** The read side: a delivered document becomes a clean row. */
export function toLocalNote(id: NoteId, doc: NoteDoc): LocalNote {
  return { ...doc, id, baseRev: doc.rev, pendingRev: null, baseContent: null }
}

/** Content equality over the three content fields, and only those — the *content half*
 *  of 02's fast-forward test. `deletedAt` is deliberately not compared here: `ForkPoint`
 *  has no `deletedAt`, so it cannot be. The deletedAt-as-boolean rule (two deletes carry
 *  different millis and would conflict pointlessly) belongs to the caller — see
 *  `domain/reconcile`, which holds both `deletedAt`s because it compares `ServerState`.
 *  Corrected 2026-09-06; the previous comment claimed a behaviour this body never had. */
export const sameContent = (a: ForkPoint, b: ForkPoint): boolean =>
  a.title === b.title && a.titleIsCustom === b.titleIsCustom && a.body === b.body

/** The three content fields, picked explicitly — never a spread of a row or a doc. */
export const forkPointOf = (x: ForkPoint): ForkPoint => ({
  title: x.title,
  titleIsCustom: x.titleIsCustom,
  body: x.body,
})

/**
 * What a pure sync step asks the store to do. `applySnapshot` and `commitPush` return a
 * list of these and the engine applies them in one store transaction, in order.
 */
export type RowWrite = { op: 'put'; row: LocalNote } | { op: 'delete'; id: NoteId }
