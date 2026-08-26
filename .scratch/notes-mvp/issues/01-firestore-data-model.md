# Firestore data model and security rules

Type: grilling
Status: resolved

## Question

What shape does a Note take in Firestore, and what rules enforce that one user can never read or
write another's?

Settle: whether Notes live in a top-level `notes` collection carrying a `userId`, or nested under
`users/{uid}/notes`, and what that choice costs in query flexibility and rule simplicity. Which
fields a Note document carries — id, title, body, createdAt, updatedAt, deletedAt, and whatever
version field ticket 02 turns out to need. Whether title is stored or derived from the first line
of the body. Which composite indexes the list and Trash queries require. What the security rules
say, and how we test that they actually deny cross-user access rather than assuming they do.

This is the foundation ticket: 02 and 03 both build on its answer.

## Answer

### Layout

Notes live at `users/{uid}/notes/{noteId}` — a subcollection, not a top-level collection with a
`userId` field. Isolation becomes a property of the path rather than of every query remembering a
`where` clause, so there is no query that can be written wrongly and leak. The cost is cross-user
collection-group queries, which only sharing would want, and sharing is out of scope.

Document IDs are Firestore auto-IDs, which are generated client-side with no round trip, so a Note
can be created offline.

### Document shape

```
users/{uid}/notes/{noteId}
  title           string         never empty — see title resolution below
  titleIsCustom   boolean        false = Derived, true = Custom; one-way latch
  body            string         markdown source
  createdAt       number         epoch millis, client clock, set once
  updatedAt       number         epoch millis, client clock, bumped on every edit
  deletedAt       number | null  Tombstone; null = live, timestamp = in Trash
  <version>       ?              RESERVED — ticket 02 names it and defines its semantics
```

Deliberately absent: no `userId` (it is the path), no `tags`/`folder` (out of scope), no `synced`
flag (local-store state, which belongs to ticket 03, not to the server document).

### Timestamps are client-side epoch millis

`updatedAt` and `createdAt` are set from the device clock, not `serverTimestamp()`.

This is the load-bearing decision of this ticket. `serverTimestamp()` reads back as `null` from the
local cache until the server commits the write (default `SnapshotOptions.serverTimestamps` is
`'none'`; `'estimate'` exists but must be passed at every `.data()` call site and is not cleanly
available on `onSnapshot` listeners — firebase-js-sdk#3848). In an offline-first app that means the
writes we care most about — the ones made with no network — would have no sort key and nothing for
ticket 02's last-write-wins to compare.

The accepted cost is clock skew: two devices can disagree about which edit came later. Bounding
that is ticket 02's problem and is tractable; a null field is not. A `serverUpdatedAt` audit field
was considered and rejected as unused weight.

### Title resolution

A Note is either **Derived titled** or **Custom titled** (see `CONTEXT.md`). The latch flips the
moment the user types in the title field and never flips back.

`title` is **always persisted**, in both states, so every reader — list, search, sync, conflict
copies — reads one field and never needs to know the latch exists. It rides along in the same
debounced save as the body, so it costs nothing extra.

Resolution order, evaluated whenever the Note is saved:

1. **Custom titled and non-empty** → whatever the user typed.
2. **Derived titled, body has a non-empty line** → first non-empty line of the body, leading
   markdown heading markers (`#`, `##`, …) stripped, whitespace trimmed, truncated to 100
   characters.
3. **Otherwise** (empty body while Derived, or a Custom title the user has emptied) → the **Default
   title**, `Untitled Note N`.

A title is mandatory and `title` is therefore never empty in the database. The default guarantees
this at creation time, which is what makes the strict rule below safe: the document is written with
a real title from birth, so nothing is ever held only in memory waiting to be titled.

The Default title does **not** latch. A Note created empty gets `Untitled Note 3`, and if the user
then types `# Groceries` into the body while still Derived titled, the title becomes `Groceries`.

**`N` is assigned as one greater than the highest `Untitled Note N` currently in the local mirror**,
so numbers are never reused after a delete and existing Notes are never renumbered. Two devices
creating a Note while both offline can independently produce the same `N`; this is accepted as
harmless, since Notes are identified by id and duplicate titles are legal anyway (two Notes may
both be called `Groceries`). Flagged as an assumption rather than a confirmed decision — the
alternative, a globally coordinated counter, is not obtainable offline.

### Security rules

Ownership **plus** shape validation, since the rules are the one enforcement point a buggy or
compromised client cannot bypass:

- `request.auth != null && request.auth.uid == uid` — matched on the path.
- `title` is a string and is **not empty**. Safe precisely because of the Default title.
- `titleIsCustom` is a bool; `body` is a string; `createdAt` and `updatedAt` are numbers;
  `deletedAt` is a number or null.
- `updatedAt` is not absurdly future-dated, guarding against a skewed client clock poisoning
  ordering for every other device.
- `createdAt` is immutable after creation.

Rules are **tested, not assumed**: `@firebase/rules-unit-testing` against the Firestore emulator,
written as failing tests first per the map's TDD rule. Non-negotiable cases: a signed-in user
cannot read or write another user's path; an unauthenticated request is denied; a write with an
empty title is denied; a write with a wrongly-typed field is denied.

#### Amendment, 2026-08-26 (`builder`) — the rules above predate ticket 02 and would reject every Conflict copy

The field list was written before 02 named `rev` and before the Conflict copy existed. If the shape
validation is strict — and the whole reason it is here is that it should be — then the conflict
branch's write is **denied by our own rules**. The failure mode is the bad one: a permanently stuck
Outbox sitting behind a strip that reassures the user their notes are safe on this device, with no
error anywhere the user can see. This must be fixed before the rules are first deployed, not
discovered at build step 5.

The complete permitted field set for a Note document is:

| Field | Rule |
|---|---|
| `title` | string, non-empty |
| `titleIsCustom` | bool |
| `body` | string |
| `createdAt` | number, immutable after creation |
| `updatedAt` | number, not absurdly future-dated |
| `deletedAt` | number or null |
| `rev` | **string, required, non-empty** (ticket 02's opaque token — never a number, never compared for order) |
| `conflictOf` | **string or absent** — the id of the Note this document is a Conflict copy of |
| `conflictBase` | **map or absent** — the fork-point content 02 stores alongside the copy |

Two things the rules must **not** do, both of which look like good ideas and are not:

- **Do not require `conflictOf` and `conflictBase` to appear together**, and do not validate
  `conflictBase`'s interior shape. It is fork-point *content*, its shape is the domain layer's, and
  a rule that knows its fields is a rule that must be redeployed whenever the domain changes. Rules
  enforce ownership and the things a compromised client could use to corrupt another device's view;
  they are not a schema validator for our own data structures.
- **Do not attempt to validate `rev`'s provenance.** It is client-minted by design — 02's retry
  recognition (`srv.rev === pendingRev`) requires the writer to know the token before the round
  trip. A rule that tried to constrain it would break the mechanism it was meant to protect.

If the rules use a closed field allowlist (they should — an open one lets a compromised client
write arbitrary bloat into the corpus), that allowlist is exactly the nine fields above.

**Emulator tests owed at build step 5, named so they are not forgotten:** a Conflict copy carrying
`rev` + `conflictOf` + `conflictBase` is **accepted**; an ordinary Note with `rev` and neither
conflict field is **accepted**; a document with `rev` absent is **denied**; a document carrying an
unknown field is **denied**. The first of those is the regression test for this amendment, and it is
the one that would have failed in production.

### Indexes

Deferred, with the reason stated. The queries that would need composite indexes are the live-list
(`deletedAt == null` ordered by `updatedAt desc`) and the Trash list (`deletedAt != null` ordered by
`deletedAt desc`). But whether those run against Firestore at all depends on **ticket 03**: if the
full corpus is mirrored locally — which offline-first and client-side search both point toward —
the app subscribes to the whole subcollection and filters in memory, and no composite index is
required. Revisit once 03 is settled rather than provisioning indexes that may never be queried.

### Body size

Firestore caps a document at 1 MiB. A note body will never approach this, but an oversized write
queued offline fails at commit time, silently, which is the worst possible way to lose writing. A
length check at save with a visible error is a few lines and is in scope for the editor.
