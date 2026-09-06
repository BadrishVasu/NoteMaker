# NoteMaker — application architecture

Author: `designer`. Date: 2026-08-25.
Status: **proposed — awaiting Builder's response in this file's `## Builder's response` section.**

Derived from the closed tickets: [01](issues/01-firestore-data-model.md) (document shape, title
rules), [02](issues/02-conflict-copy-mechanism.md) (the sync mechanism — the hardest constraint
here), [03](issues/03-local-store-choice.md) (the mirror), [04](issues/04-provision-accounts.md)
(project, hostname, `signInWithPopup`), [05](issues/05-editor-and-shell-ux.md) (shell, editor,
states), [07](issues/07-pwa-service-worker.md) and [08](issues/08-auth-offline-behaviour.md).
Open and downstream of this: 06, 09, 10, 11, 12.

Builder: the sections you most need to disagree with early are **The one architectural bet**,
**Module boundaries**, and **Build order** — everything else follows from those three.

---

## The one architectural bet

**The entire sync mechanism from ticket 02 is written as pure functions, and Firestore is reached
through a single port that the tests can replace.**

02's mechanism was proven by model-checking 2.4 million interleavings — but that proof was a
throwaway spike. The implementation only inherits the proof if the implementation has the same
shape: pure decision logic, no I/O. So the port is shaped to make that possible:

```ts
// sync/remoteGateway.ts — the port. This file imports nothing from firebase.
type PushAction =
  | { kind: 'noop' }                                     // already landed
  | { kind: 'write'; doc: NoteDoc }                      // clean push
  | { kind: 'adopt' }                                    // fast-forward / delete-lost
  | { kind: 'conflictCopy'; copyId: string; copy: NoteDoc }

interface RemoteGateway {
  subscribeNotes(uid: string, onDocs: (docs: NoteDoc[]) => void): Unsubscribe
  runPush(
    uid: string,
    noteId: string,
    decide: (server: NoteDoc | null) => PushAction,   // ← ticket 02's reconcile, pure
  ): Promise<PushOutcome>
}
```

`decide` **is** `domain/reconcile.ts`. The Firestore implementation runs it inside
`runTransaction` and translates the returned `PushAction` into `transaction.set` calls. The fake
implementation runs it against an in-memory `Map` with a hook that lets a test interleave a second
device between the read and the write. **Ticket 09 gets its second device as a second engine
instance, not a second browser** — which is the difference between sync tests that run in
milliseconds on every commit and sync tests nobody runs.

Two hard consequences of this shape, both non-negotiable:

- **`decide` must be pure and safely re-runnable.** Firestore re-executes a transaction callback on
  contention. If `decide` mints a rev, increments anything, or touches the store, a retry corrupts
  it. Everything it needs — `baseRev`, `pendingRev`, our content, the copy id — is computed *before*
  the push and closed over as data.
- **`sync/firestoreGateway.ts` is the only file in the codebase permitted to import
  `firebase/firestore`.** Enforced by an ESLint `no-restricted-imports` boundary, not by vigilance.
  This is what makes 02's "no `setDoc` on a Note, ever" structural: there is exactly one file where
  such a call could physically be written, and ticket 09's test guards that file specifically.

## Module boundaries

Dependencies point downward only. Nothing below `app/` imports React; nothing below `sync/` imports
Firebase; nothing in `domain/` touches a browser API.

```
src/
  domain/       pure TypeScript. No I/O, no React, no Firebase, no IndexedDB, no Date.now() *
    note.ts           NoteDoc (01's nine wire fields), LocalNote = NoteDoc + id + baseRev +
                      pendingRev + baseContent, toNoteDoc/toLocalNote  — see "The types" below
    title.ts          resolveTitle / isDefaultTitle / nextUntitledN   (01 + 05)
    reconcile.ts      02's three equality tests + the conflict branch → PushAction
    applySnapshot.ts  the 14-cell table from 02's appendix; pure, takes/returns lastServerState too
    conflictCopy.ts   copyId/rev derived from the flight token (02 appendix defect 2) + conflictBase
    projection.ts     corpus → list view / trash view / search results   (06 lands here)

  store/        the mirror (ticket 03)
    noteStore.ts      the port: getAll, get, put, delete, runInTransaction, meta get/set
    idbNoteStore.ts   `idb`, database `notemaker-<uid>`, object stores `notes` and `meta`
    memoryNoteStore.ts the fake — same contract suite runs against both

  sync/         the engine
    remoteGateway.ts   the port (above)
    firestoreGateway.ts  ONLY file importing firebase/firestore
    fakeGateway.ts       in-memory server with interleaving hooks
    engine.ts            the loop; owns backoff, owns lastServerState (below); consults no clock,
                          no navigator.onLine
    lastServerState.ts   Map<noteId, {rev,title,titleIsCustom,body,deletedAt}>, in-memory only —
                          ratified below, this is new since 03 closed
    corpus.ts            in-memory whole corpus + subscribe(); the UI's single read surface

  platform/     browser and vendor glue, thin
    firebase.ts        initializeApp, initializeFirestore({ localCache: memoryLocalCache() }), getAuth
    persistStorage.ts  navigator.storage.persist()
    tabChannel.ts      BroadcastChannel wrapper
    lifecycle.ts       blur / visibilitychange / pagehide flush wiring (05's rule)

  app/          React. The only layer that renders.
    AppShell, NoteList, SearchField, Editor, TitleField, TrashView, SyncStrip, EmptyStates, SignIn
    hooks: useCorpus, useNote, useOutboxCount   (useSyncExternalStore over sync/corpus.ts)
```

\* `domain/` taking no clock is not stylistic. 02 dissolved ticket 01's clock-skew debt precisely
because reconciliation reads no time. `updatedAt` is stamped at the edge, in the save path, and
passed *in* as data. If a `Date.now()` ever appears under `domain/`, the property 02 proved has
quietly stopped holding.

## `lastServerState` — ratified addition, 2026-08-25

The Mathematician's extended check (`02` appendix, defects 1–3) found the original mechanism as
specified would leave a clean row permanently stale, because the conflict branch deliberately writes
no correcting snapshot. The fix needs a map of the last snapshot seen per Note, independent of
dirtiness, and asked me to ratify where it lives since 03 specified the row as "`baseRev`,
`pendingRev`, nothing else."

**Ratified: in-memory only, owned by `sync/engine.ts`, not persisted, and not part of the store
row.** This does not reopen ticket 03's stored schema — 03's own reasoning already covers it: 03
carries no resume token and re-reads the whole subcollection on every app open, so on a fresh tab
`lastServerState` rebuilds itself from the first batch of snapshots before any push can race it. The
only place it would matter un-rebuilt is mid-session after a conflict branch, which is exactly the
case the map exists to fix. Persisting it would be state that can silently go stale across a
restart for no benefit `store/` doesn't already provide by other means; keeping it in memory means
it is always either correct or freshly empty, never wrong.

Consequence for the module table below: `firestoreGateway.runPush`'s `decide` callback closes over a
snapshot of the relevant `lastServerState` entry at call time (still pure — the map read happens in
`engine.ts`, the decision function itself receives it as an argument), matching the appendix's
"fall back to the transaction read only while `initialSyncCompletedAt` is unset" rule.

## Data flow — one direction each way

**Write** — Editor textarea (the user's buffer) → debounce 600 ms, or a lifecycle flush →
`saveNote()`: resolve title (`domain/title`), mint `pendingRev`, `store.put(row)` **first**, then
update `corpus`, then `tabChannel.post(noteId)` → engine wakes and drains the Outbox.

**Read** — `gateway.subscribeNotes` → per doc `applySnapshot(localRow, serverDoc)` → `store.put` →
`corpus` → React re-renders.

Both paths converge on the store and the corpus. **No React component ever imports anything from
`sync/` other than `corpus.ts`, and nothing anywhere reads Firestore for display.** The store is
authoritative on disk; the corpus is authoritative in the tab; the store is always written first, so
a crash between the two loses a re-render, never a keystroke.

## Where the closed tickets land, concretely

| Constraint | Owner in this architecture |
|---|---|
| 02: every Note write via `runTransaction` | `firestoreGateway.runPush`, the sole firebase importer |
| 02: `baseRev` only advances to a rev the listener delivered (clean) or this device pushed | `engine.ts`, applying `PushOutcome` per the appendix's 14-cell table |
| 02: snapshots never overwrite a dirty body, but do always record `lastServerState` | `domain/applySnapshot.ts` (pure), `sync/lastServerState.ts` (in-memory, owned by `engine.ts`) |
| 02 appendix: copy id/rev keyed off the flight token, not existence+pristine | `domain/conflictCopy.ts` |
| 02 appendix: Outbox slot migrates only onto the copy this push just wrote | `engine.ts`, applying `PushOutcome.conflictCopy` |
| 02 appendix: per-Note pushes parallelise freely; one in-flight push per Note | `engine.ts` — a `Map<noteId, Promise>` gate, nothing more |
| 02: editor follows the content, not the id | `corpus.ts` emits a redirect event; `Editor` does `history.replaceState` (05 §conflict redirect) |
| 03: whole corpus in memory, no queries | `corpus.ts`; `projection.ts` filters arrays |
| 03: Outbox is `pendingRev !== null` | `LocalNote`, one row, one atomic put |
| 03: `initialSyncCompletedAt` | `store` meta; read by `EmptyStates` to pick between four screens |
| 03: `navigator.storage.persist()` | `platform/persistStorage`, called on first successful sign-in |
| 01: title rules and the one-way latch | `domain/title.ts`; `TitleField` renders the latch (05) |
| 05: save flushes on blur/visibilitychange/pagehide | `platform/lifecycle.ts`, wired once in `AppShell` |
| 08: gate UI on auth state, never on tokens | `SignIn` / `AppShell` subscribe to `onAuthStateChanged` only |
| 07: no runtime caching, precache the shell only | `vite-plugin-pwa` config; nothing in app code |

## Build order

Every step is red-green-refactor and every step ends with something that can be run or seen.

0. **Scaffold, then deploy it empty.** Vite + React + TS, Vitest, ESLint with the import-boundary
   rule, and **ticket 10 done immediately** — a blank page live on `pages.dev` before there is
   anything to be blocked by a broken pipeline. The destination is a *running* app; the pipeline is
   the part most likely to surprise us and the cheapest to de-risk at zero complexity.
1. **`domain/title.ts`** — the project's first failing test. Pure, no infrastructure, and it locks
   ticket 01's most fiddly rules down before any UI can drift from them.
2. **`store/` contract suite** — one suite, run against `memoryNoteStore` and `idbNoteStore`. This
   is the seam everything above depends on, and it is worth having real before the engine exists.
3. **`domain/reconcile` + `applySnapshot` + `conflictCopy`** — 02's mechanism as pure units,
   including its two model-checked traps as named regression tests.
4. **`sync/engine` against `fakeGateway`** — two engine instances, one shared fake server,
   interleaved. This is the bulk of ticket 09 and it is where a data-loss bug would be caught.
5. **`firestoreGateway` + emulator** — security rules tests (01) and real transaction semantics.
   The emulator's scope is *only* what the fake cannot honestly model.
6. **Shell, list, editor** (05 variant A) against a seeded store, still no network. The app becomes
   usable offline-only at this point.
7. **Auth, `persist()`, the four first-load states**, then real end-to-end on two devices.
8. **Then the open tickets**: 06 search, 12 back-button, 11 merge.

Steps 1–4 need no browser and no Firebase account. That is deliberate: the riskiest logic in the
product is also the cheapest to test, and it should be finished before any of it is entangled with a
UI.

## Open questions for the Builder

1. **`useSyncExternalStore` over `corpus.ts`, or a small state library?** I have specified the
   former — the corpus is one array and one subscribe, and a library would be abstraction without a
   second use case. If you have a concrete reason a store library earns its place, this is the place
   to say it.
2. **Where do the fakes live** — shipped in `src/` (so the contract suite imports them normally) or
   quarantined in a test directory? I lean `src/` with a lint rule preventing production imports;
   your call as the one who runs the build.
3. **Is deploy-at-step-0 right?** It front-loads ticket 10 ahead of any feature. I think the
   destination being "running, not specified" makes that correct, but it is your pipeline.

## Builder's response

`builder`, 2026-08-25. Implementation-readiness assessment. **No deadlock — I accept the spine.**
The bet, the module boundaries and the build order are right, and the import-boundary rule is a
better guard than 02's name-list. What follows is the gap list, and it is the useful part.

### Your three questions, answered

1. **`useSyncExternalStore`, yes — with one amendment I need in the design, not left to me.**
   A single whole-corpus snapshot means every list row re-renders on any change; at 03's ~2,000-Note
   tripwire that is visible jank while typing. So `corpus.ts` must hold a `Map<noteId, LocalNote>`
   of **immutable rows**, and expose `getNote(id)` returning a stable identity for unchanged Notes
   plus a version counter the list projection memoises on. Then `React.memo` rows are free. That is
   a data-structure choice, not a library — no store library earns its place here and I am not
   asking for one.
2. **Fakes in `src/`, with the lint rule.** Agreed, no reservation. A fake that lives outside the
   type-checked, linted tree drifts from the port it is meant to satisfy.
3. **Deploy at step 0 — strongly yes, and go one step further.** Step 0 should also prove *auth*
   end-to-end: a sign-in button that renders the uid and nothing else. Ticket 04's popup topology
   (`pages.dev` app origin vs `firebaseapp.com` auth domain, the referrer allowlist, the auth
   handler's own key use) is the other thing that works locally and fails only in production. Two
   extra hours at zero complexity, or a day of confusion in week three.

### Gaps I need closed before I cut slice 1

Ordered by cost of finding them late.

1. **`deviceId` exists nowhere.** 02's Conflict-copy id is `noteId` joined to a device id and
   nothing in 01/03 or this document mints, stores or defines one. Proposal: `store` meta,
   per-uid, minted once, never rotated. Two consequences to state out loud rather than discover:
   a mirror eviction regenerates it, so the "one copy per Note per device" coalescing degrades to
   one extra copy — acceptable; and a Conflict copy that itself conflicts produces
   `noteId__dev__dev`, so the id needs a length guard against Firestore's 1500-byte doc-id cap.
2. **Ticket 01's security rules are stale and will reject every Conflict copy.** They were written
   before 02 named `rev` and before `conflictOf`/`conflictBase` existed. If the shape validation is
   strict, the conflict branch's write is denied — and the failure mode is a permanently stuck
   Outbox behind a strip that reassures the user their notes are safe. The rules must admit
   `rev: string`, `conflictOf: string?`, `conflictBase: map?`. Named emulator test at step 5.
3. **Nothing in this design triggers a push.** `engine.ts` "owns backoff" is one line standing in
   for a real policy, and with `navigator.onLine` deliberately gone the wake sources are not
   obvious. I want this blessed as a decision rather than inherited as whatever I write:
   - **Wake on**: a local edit; `visibilitychange → visible`; **snapshot delivery**; and a backoff
     timer. A delivered snapshot is honest proof the transport is up — it is the one connectivity
     oracle in this design that is not a network claim, and it costs nothing.
   - **Backoff**: 1s, doubling, capped at 60s; reset on any successful push *or* any snapshot.
   - **Each push needs a hard timeout (~10s).** `runTransaction` retries internally and under a
     flaky connection can hang well past a user's patience, blocking the drain behind it.
4. **`conflictBase` halves the effective body cap, and 05's threshold is set at the wrong number.**
   A Conflict copy carries its own content *plus* the fork-point content in one document, against
   Firestore's 1 MiB. A 600 KiB Note that conflicts produces a copy over the cap: the transaction
   fails permanently, the Outbox never drains, and the user's only signal is the strip telling them
   everything is fine. 05 sets the visible "too large to sync" threshold at ~1 MiB; for any Note
   that could ever conflict — which is all of them — it must be ~450 KiB. One number, and it is the
   difference between a visible failure and a silent stuck one.
5. **Push concurrency across Notes is unspecified.** 02 defines one Note's transaction in isolation.
   Until I have an answer I will **serialise the drain** — safe, and parallelising later is local to
   `engine.ts`. I have put the question to the Mathematician.
6. **The 30-day purge is unspecified and it is a *write*.** A purge is a hard delete, the one Note
   write that is not an edit, and it must route through the same gateway or it punches a hole in
   "only `runTransaction` touches a Note". Nobody has decided whether it runs client-side on open.
   Not blocking slice 1. **Recommendation: no purge at all in v1** — the Trash simply grows, which
   costs nothing at this corpus size — and ticket it rather than improvising it. Critically, the
   mirror must never purge locally ahead of the server, or the Note resurrects on the next snapshot.
7. **`applySnapshot` has no defined behaviour for an absent `serverDoc`.** Removed-doc events are
   real (another device's hard delete, or a purge) and the row may be dirty. Sent to the
   Mathematician as part of a full state table — see below.

### One number in 03 I think is optimistic

03 prices the full re-read per app open as "comfortable at a few hundred Notes" against the 50k/day
free quota. That arithmetic assumes desktop-shaped app opens. This design's own premise is that
**Android backgrounds and reaps the app constantly** — an "app open" is not a once-a-day event, it is
plausibly 20–50 times a day. At 500 Notes that is 10–25k reads/day, i.e. already at or past 03's own
"half the quota" tripwire. I am not asking to reverse the decision: `persistentLocalCache` is the
one-line reversal 03 already sanctioned, and the watermark stays dead. I am asking that step 7
**measure reads per open once and check the arithmetic against reality** instead of inheriting it.

### What I need from you that this document does not yet give me

- **The literal `NoteDoc` and `LocalNote` TypeScript types, field by field**, marking which fields
  are local-only and must never be serialised to Firestore (`baseRev`, `pendingRev`) and which
  appear only on Conflict copies. This is the single artifact every module commits to and the one
  place a wrong field is genuinely expensive to unwind. It is also the cheapest thing you can hand
  me.
- The push trigger policy (gap 3) blessed or corrected.
- Where `deviceId` lives (gap 1).

### On the Mathematician

I have already sent it the **`applySnapshot` state table** question — specifically that 02's model
interleaved `edit`/`delete`/`begin-push`/`commit-push` but appears **not to have modelled
`snapshot-delivered` as an event**, even though 02's second trap is about snapshots. If that is
right, the snapshot path is the one part of the mechanism carrying an unverified invariant, and it
is the part that fails silently and late. Your transaction-retry question below is a different
question and both are with it; no need to send either twice.

### Manual save (05, open with Badrish) — an execution objection

If manual save is built as a *mode*, `pendingRev !== null` stops being the definition of dirty, and
answering "does local differ from last-pushed" requires a second stored field or hash. That is a
second field encoding related state — precisely what 03 rejected when it killed the `synced`
boolean, and it lands inside the invariant 02 model-checked. **I would rather it be a `Push now`
button alongside always-on auto-push than a mode**: Badrish gets the same control, and 02's and 03's
invariants do not move at all. Raised with him; not mine to settle.

### Taken as mine, stated so nobody waits on it

- **List ordering: `updatedAt desc`, no pinning.** 05 left it provisional and I cannot render a list
  without an order. Trivially reversible, one comparator.
- **No build team yet.** Steps 0–4 are the pipeline plus pure logic and I hold them in one head;
  summoning specialists there would cost coordination and buy nothing. I bring in Frontend and
  UI/UX at step 6, QA at step 5, Operations only if the Pages pipeline fights back.

## Read cost and the server clock — designer, 2026-08-26

Attaches to the Builder's "one number in 03 I think is optimistic" above. Badrish asked why the base
clock we compare against can't be the server's. **No change to this architecture.** `domain/` still
reads no clock, `reconcile` is still three equality tests on locally-minted tokens, and `rev` cannot
become a server timestamp — the push must know the token it is writing before the round trip, or a
retry after a lost response cannot recognise its own landed write.

What the question does change is 03's *stated reason* for killing the watermark, which was
client-clock skew and therefore does not apply to a server-stamped field. Full amendment on ticket
03. It stays unadopted because a filtered query never delivers removals, and `persistentLocalCache`
is the cheaper, correct fix for the same read cost. **Builder: your step-7 measurement is now the
deciding input for this, not just a sanity check** — if reads per open come in where you expect,
the reversal is the one line 03 already sanctioned, and the watermark stays off the table.

## For the Mathematician — answered

Asked whether `runPush`'s transaction-callback shape preserves 02's proof under Firestore's
re-execution-on-contention. Answer came back sharper than the question: the original check hadn't
modelled `onSnapshot` at all, and the corrected, lineage-based property (P1b) found three real
defects once it was added — appendix on `02`. All three are folded into this document above
(`lastServerState`, the flight-token copy id, and the "only adopt what this push just wrote"
migration rule). Also confirmed: per-Note pushes are independent and safe to parallelise, and
`applySnapshot` still needs no knowledge of in-flight pushes — the pure-seam bet holds.

**Owed before code ships**, per the appendix's "accepted, not fixed" section: a test asserting that
`delete-lost` discards unsynced edits made *before* the delete in the same dirty episode. Named so
here so it isn't later mistaken for a bug and "fixed" back into a Conflict copy nobody asked for.
`sync/engine.test.ts` or wherever 09 lands its `delete-lost` coverage.

## Builder's addendum — gaps closed, 2026-08-26

Badrish answered the three open questions and the Mathematician's appendix answered two of my seven
gaps outright. This section closes the rest. **Step 0 starts now**; ticket 10 carries the full deploy
configuration and this document's build order is otherwise unchanged.

### Closed by the Mathematician's appendix, not by me

- **Gap 5, push concurrency across Notes.** Answered: per-Note independence is total. I withdraw the
  serialised drain I had taken as a holding position — `engine.ts` gets the `Map<noteId, Promise>`
  gate this document already specifies, one in-flight push per Note and free parallelism across
  Notes.
- **Gap 7, `applySnapshot` with an absent `serverDoc`.** Answered by the 14-cell table and its
  dedicated section. Cell 7 — dirty row, server document gone — is a **no-op that keeps the row and
  its dirt**, and that is the cell ticket 13's purge must not be allowed to break.

### Gap 1, `deviceId` — taken as mine

Minted once per uid, stored in the `meta` object store beside `initialSyncCompletedAt`, from
`crypto.randomUUID()`, **truncated to its first 8 characters**, never rotated. Read at engine start;
if absent, minted and written before the first push can run.

Short because it goes into a Firestore document id — the copy id is
`<noteId>__c<deviceId>__<flightRev>` — and Firestore caps a document id at 1500 bytes. A Conflict
copy can itself conflict, which nests the pattern, so the id must be *checked* against the cap at
mint time rather than assumed safe: with 8-character device ids the nesting depth available is
comfortable, but "comfortable" is not "verified", and the check is three lines in
`domain/conflictCopy.ts` where it can be unit-tested with no infrastructure.

One consequence, stated so it is a decision rather than a discovery: **a mirror eviction regenerates
the `deviceId`**, and the same physical device then presents as a new one. Since the Mathematician's
fix already keys the copy id on the flight token rather than on device identity alone, this costs
nothing beyond an unfamiliar-looking id. It is not worth persisting elsewhere.

### Gap 3, the push trigger — taken as mine, and it is `engine.ts`-local

I asked for this to be blessed rather than inherited. Nobody has contested it, it is entirely
internal to one file, and reversing it costs one function — so I am taking it and recording it here
so nobody has to re-derive it:

- **Wake sources:** a local edit; `visibilitychange → visible`; **snapshot delivery**; and a backoff
  timer. Snapshot delivery is the one honest connectivity oracle this design permits — it is
  evidence the transport is up rather than a claim about the network, which is the distinction
  ticket 02 removed `navigator.onLine` to protect.
- **Backoff:** 1s, doubling, capped at 60s. Reset on any successful push **or** any delivered
  snapshot.
- **Hard per-push timeout, 10s.** `runTransaction` retries internally and under a flaky connection
  can hang far past a user's patience. Without a timeout one wedged push holds its Note's gate
  indefinitely. With per-Note parallelism this no longer blocks the whole drain, which is a second
  reason the appendix's answer was worth having.
- **`Sync Now` (ticket 05) is a fifth wake source** that additionally resets the backoff timer, and
  with `Auto sync` off it is the *only* one. The setting gates the trigger; it never gates the
  `pendingRev` mint, the mirror write, or the guard predicate.

### Naming, binding on every surface — Badrish, 2026-08-26

The user-facing button is **`Sync Now`** and the setting family is **`Auto sync`**. Where this
document says *push* it is describing our mechanism and that is fine in `sync/`; where a string
reaches a user it says sync. `05` carries the full spec.

### Service worker: `registerType: 'prompt'`

Badrish's call, 2026-08-26. It lives in `vite.config.ts`'s `vite-plugin-pwa` block — "nothing in app
code" in the table above stays true except for the one reload affordance, which is UI/UX's at step
6 and shares the shell's bottom strip region with `N notes waiting to sync`. Ticket 10 holds the
reasoning and the consequences.

### Still owed by the Designer, and when it starts blocking

**Delivered 2026-09-01 — see [The types](#the-types--domainnotets--designer-2026-09-01) at the end
of this document.** The ask, kept for the record:

**The literal `NoteDoc` / `LocalNote` types, field by field**, marking local-only fields (`baseRev`,
`pendingRev`) and Conflict-copy-only fields (`conflictOf`, `conflictBase`). Step 0 does not need
them and step 1 (`domain/title.ts`) barely does. **They block step 2**, the `store/` contract suite,
because that suite is a commitment to the row shape. That is the deadline, and it is close.

Meanwhile ticket 01's field list is now amended to the full nine-field set including `rev`,
`conflictOf` and `conflictBase`, so the security rules and the types have one source to agree with.

## The types — `domain/note.ts` — designer, 2026-09-01

This is the artifact the Builder asked for at "What I need from you", and it is `src/domain/note.ts`
verbatim: this file compiles as written, imports nothing, and is what step 2's `store/` contract
suite commits to. Every field is annotated **W** (goes to Firestore), **L** (local-only, must never
be serialised) or **C** (Conflict copies only).

```ts
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

/** In-memory only, owned by `sync/engine.ts`, never persisted (02 appendix, defect 1). */
export type ServerState = ForkPoint & Pick<NoteDoc, 'rev' | 'deletedAt'>

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
```

`store/`'s `meta` object store is key-value and carries exactly three keys, typed here so the
contract suite can assert them: `initialSyncCompletedAt: number | null` (03), `deviceId: DeviceId`
(Builder's gap 1), and `persistGranted: boolean` (03's silent retry per open).

### The one thing the tickets were missing — `baseContent`

Writing the types surfaced a real hole, and it is the reason this artifact was worth doing before
step 2 rather than during it.

**02 requires a Conflict copy to carry `conflictBase`, the fork-point content — and under the row
shape as specified, the fork-point content is not available at push time.** The row holds our *tip*
(the user has edited it, that is why it is dirty). `lastServerState` holds *their* tip. `baseRev`
names the fork point but nothing stores its content. So `conflictBase` would be written from
whatever was to hand, and 02 is explicit that this field "genuinely cannot be retrofitted": get it
wrong and every merge in ticket 11 is silently two-way forever, unable to tell "I added this line"
from "they deleted this line".

**Fix: `baseContent: ForkPoint | null` on the mirror row, local-only.**

> **Superseded, 2026-09-06 — do not implement the rule this section used to state.** It named
> **two** capture points: clean → dirty, and "commit of a clean push". The Mathematician
> model-checked it (02, "Appendix — `baseContent`'s capture points, model-checked") and it is **not
> sufficient — three gaps, two of which silently write a wrong `conflictBase`**, the one field 02
> says cannot be retrofitted. The old rule is kept above in this sentence rather than deleted, so
> that anyone who saw it recognises what replaced it. The corrected rule follows.

The defect in the old wording is worth naming, because it is a pattern and not a typo. The rule was
keyed to a **branch** ("commit of a clean push") when the thing it actually depends on is a **state
change** (`baseRev` moved). `baseContent` is a *function of the row's `baseRev`*, so it must be
re-established wherever `baseRev` moves — and a branch-keyed rule goes stale the moment a branch is
added, which is exactly how it missed three of them. Stated once, against the state change:

> **`baseContent := the content that was in flight` at every point where `baseRev := flightRev` and
> the row remains dirty; `baseContent := null` at every point where the row becomes clean.**

Expanded into the three places the engine touches it:

1. **Clean → dirty** (first keystroke, or first delete, on a clean row): `baseContent := the row's
   content before the edit`. Unchanged from the original. A clean row always has `baseRev !== null`
   (`P-CLEAN`), so this never captures against a null base.
2. **Any commit that advances `baseRev` to the flight token — four of the transaction's branches,
   not one.** `srv.rev === baseRev` (the clean push, the only one the old rule named);
   `srv.rev === pendingRev` (already landed — retry after a lost response, or a second tab);
   recreate into an absent document; and the first landing of an unlanded create
   (`baseRev === null`). Typed during the flight → `baseContent := the in-flight content`;
   otherwise the row goes clean and `baseContent := null`.
3. **Conflict-branch outbox-slot migration — the transition the old rule did not mention at all,
   and the dangerous one.** When the slot migrates onto the copy row *and the user typed during the
   flight*, the migrated copy row takes `baseRev := flightRev` and therefore `baseContent := the
   in-flight content` — the same value just written as the copy's `conflictBase`. Nothing typed →
   the copy row is born clean, `baseContent := null`. Without this, the copy row carries a
   `baseContent` from before the conflict, and the model reaches a trace where that value is written
   to a real server document as a `conflictBase` **two generations stale**.

**No `applySnapshot` cell needs a capture.** Cell 9 is the only cell that moves `baseRev` on a dirty
row and it clears dirty, so `baseContent := null` covers it. Cell 7 (document absent, dirty row) is
a no-op and **must stay one** — retaining `baseContent` there is correct, because the fork-point
content is a historical fact about a rev, not a live fact about the document.

Cost: one body-sized string per dirty row, in IndexedDB only, never on the wire.

**Two checks, at two different seams — pin both.**

- **`P-INV`, the row-shape invariant, in the `NoteStore` contract suite:** `baseContent !== null` if
  and only if `pendingRev !== null && baseRev !== null`. Confirmed by the model to be **exactly
  right** under the corrected rule — neither too strong (it rejects no legitimate row) nor unsafe to
  enforce on every write. It stays as written.
- **The lineage assertion, at the reconcile — a separate and strictly stronger check:**
  *`baseContent` equals the content this row's `baseRev` was written with.* `P-INV` is a **shape**
  check, and shape is not lineage: the migration gap produces a row with non-null `baseContent` and
  non-null `baseRev`, so the biconditional is satisfied by a value that is simply wrong. Run against
  the broken design, `P-INV` survived ~900k states without firing while the lineage property failed
  at depth 6. This one needs a fixture that remembers content per rev, which is why it belongs where
  `reconcile` is tested and not in the store contract suite. Without it, `P-INV` is a shape check
  wearing a correctness check's name.

**Swept the rest of this document for the same defect (2026-09-06), since branch-keyed rules are a
pattern and not a one-off.** No second offender. The reason is worth knowing rather than trusting:
the other two rules that could have had this shape are already written against state, not branches
— "snapshots never overwrite a dirty body but *always* record `lastServerState`" is keyed to the
event unconditionally, and `applySnapshot` is specified as a **14-cell table over states** rather
than as a list of branches, which is structurally immune to a branch being added later. That table
is the antidote, and it is the form to prefer for any rule added to this design from here. Two
narrower rules key off a *condition* rather than a branch and are fine as written: `toLocalNote` is
valid only for an insert into an absent row (decision #8), and `decide` falls back to the
transaction read only while `initialSyncCompletedAt` is unset.

**This amends ticket 03's "the mirror row is 01's shape plus `baseRev`, `pendingRev`, and nothing
else."** It does not touch the wire document, the rules, the three equality tests, or the snapshot
guard predicate. It is not a second field encoding an existing fact — the fact it carries exists
nowhere else — so it is not the `synced`-boolean mistake 03 rejected.

**Sent to the Mathematician rather than asserted, and it came back wrong — as designed.** The
two-capture-point claim was reasoned, not model-checked, and it was the same class of claim as 02's
original snapshot rules, which were also reasoned and also wrong. Sending it is the part that
worked; the correction above is the result. The field's *presence* was never in doubt, which is why
step 2 was not blocked on this.

### Decisions I had to make rather than look up

Each of these was underdetermined by the tickets. Listed because these are the parts worth
overturning now if they are wrong.

1. **Branded `NoteId` / `Rev` / `DeviceId` instead of bare `string`.** This design has three
   distinct strings in flight at once, and `copyId = <noteId>__c<deviceId>__<flightRev>` mixes all
   three. Passing a `noteId` where a `rev` belongs typechecks perfectly as bare strings and fails as
   a wrong equality test inside the reconcile — silent, and in the one function the whole mechanism
   rests on. Cost: three casts at the boundaries and slightly noisier test fixtures. **Reversal is
   three lines** (`type Rev = string`), so this is a cheap default, not a commitment.
2. **`NoteDoc` has no `id`.** Forced, once you read 01's amendment as a *closed* allowlist: an `id`
   field is an unknown field and the write is denied. The failure mode is the bad one — denial only
   happens online, so it presents as a stuck Outbox behind a strip that says the notes are safe.
   Reads carry the key alongside as `IdentifiedDoc`.
3. **Two different absence conventions in one document, deliberately.** `deletedAt` is
   `number | null`, always present; `conflictOf`/`conflictBase` are *absent*, never null. This is
   not inconsistency: `deletedAt` is a live↔Trash toggle that must round-trip, and 01's rules require
   it typed as number-or-null; the conflict fields are set at birth and never change, and 01's rules
   say "string or absent". Writing `conflictOf: null` on an ordinary Note would be denied.
4. **`ConflictCopyDoc` narrows on `conflictOf` alone, not on both fields.** 01 forbids the rules
   from requiring the two together, and I found the reachable case that justifies it: a dirty row
   with `baseRev === null` has no fork point, so a copy born from it legitimately has `conflictOf`
   and no `conflictBase`. Ticket 11's merge UI degrades to two-way there rather than crashing.
5. **`LocalNote extends NoteDoc`, and the leak is caught by a test rather than by the type system.**
   The alternative — nesting the wire doc as `{ id, doc, baseRev, ... }` — makes leakage structurally
   impossible but turns every field access into `row.doc.title` across the entire app. I took
   ergonomics, because TypeScript's excess-property check does fire on the object literal that
   `reconcile` returns, and because the runtime guard is one assertion: **`Object.keys(toNoteDoc(x))`
   equals exactly the expected key set** for a fully-populated conflict copy and for an ordinary
   Note. Named for the Builder as a required step-2 test; it is the guard, and it must exist before
   `toNoteDoc` does.
6. **`ForkPoint` is one type used three ways** rather than three structurally-identical interfaces.
   `conflictBase`, `baseContent` and the content half of `ServerState` are the same three fields
   because they are the same concept, and giving them one name is what makes `sameContent` usable
   against all of them. `ServerState` derives `rev`/`deletedAt` by `Pick` so it cannot drift from
   `NoteDoc`.
7. **No `sendRequested` field on the row.** 02's manual-send amendment contemplated "a client-only
   'send requested since last dirty' bit"; the Builder's later trigger policy made `Sync Now` a
   *global* wake source rather than a per-Note affordance, which removes the need entirely. If a
   per-Note send ever returns, it belongs in engine memory, not in the persisted row. Recording this
   so the two documents are not read as disagreeing.
8. **`toLocalNote` sets `baseRev := doc.rev`.** Only correct for an insert into an absent row
   (`applySnapshot` cell 2). It is not a general-purpose constructor and the cells that adopt into an
   existing row must not route through it.

### tsconfig requirements these types assume

Two, both non-default, both load-bearing rather than stylistic:

- **`exactOptionalPropertyTypes: true`.** Without it, `conflictOf?: NoteId` accepts an explicit
  `undefined`, and an `undefined` reaching Firestore throws at write time — inside a transaction,
  where it presents as a failed push.
- **`strict: true`**, for `strictNullChecks` specifically: `baseRev`, `pendingRev` and `baseContent`
  are all `T | null` and the entire mechanism is a set of null discriminations.

And one Firebase setting, stated here because it is the mirror image of the first: **leave
`ignoreUndefinedProperties` off.** Turning it on converts a bug in `toNoteDoc` from a thrown error
into a silently dropped field.

### Testable seams this creates, in step-2 order

1. `toNoteDoc` key-set assertion, both shapes — decision #5's guard. **Write this first.**
2. The `baseContent` row-shape invariant (`baseContent !== null ⟺ pendingRev !== null &&
   baseRev !== null`), asserted in the `NoteStore` contract suite so it holds against the fake and
   against `idb`. **This is shape only** — the lineage assertion that actually protects
   `conflictBase` is seam 6, at step 3.
3. Round-trip: `toLocalNote(id, doc)` then `toNoteDoc` returns a document deep-equal to `doc`.
4. `sameContent` ignores `updatedAt`, `createdAt` and `rev`. **Corrected 2026-09-06:** this seam
   used to also claim `deletedAt`-as-boolean was pinned here. It cannot be — `sameContent` takes
   `ForkPoint`, which has no `deletedAt`. The code was always right; this seam and the comment were
   not. The deletedAt-as-boolean rule now belongs to **seam 7**, at the caller.
5. `isConflictCopy` is true for `conflictOf` without `conflictBase` (decision #4's reachable case).

Two more seams, at step 3 rather than step 2, both moved here on 2026-09-06:

6. **The `baseContent` lineage assertion, at `reconcile`:** `baseContent` equals the content this
   row's `baseRev` was written with. Needs a fixture that remembers content per rev. The three
   model-checked gaps are its named regression cases — already-landed retry, unlanded-create first
   landing, and conflict-branch slot migration (02's Gap C trace is the one to transcribe literally).
7. **Fast-forward, at `reconcile`, against `ServerState`:** content equal *and* `deletedAt` equal as
   a boolean — `sameContent(ours, theirs) && (ours.deletedAt !== null) === (theirs.deletedAt !==
   null)`. Two deletes at different millis must fast-forward, not conflict; a delete against a live
   edit must not.
