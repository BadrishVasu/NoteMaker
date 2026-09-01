# Operations' notebook — NoteMaker

## 2026-08-27 — first session: the push proposal

Brought in by the Builder for exactly one thing: get `main` in front of Badrish as a proposal he
can approve with one word, without me touching `git push`. Read the three files he pointed at
(JOURNAL.md top entry, `features/deploy-pipeline.md`, ticket 10) before doing anything else — all
three agreed with each other, which is not something to assume, it's something to check, so I
re-derived the numbers myself rather than taking the Builder's summary on faith.

### What I verified independently, and how

- `git remote -v` → `origin` is `https://github.com/BadrishVasu/NoteMaker.git`, matches what
  everyone's been assuming.
- `git fetch origin && git log origin/main..main --oneline` → 9 commits, same list the Builder
  gave. `origin/main` really is at `5da2840`.
- `git merge-base --is-ancestor 3a8bdaa origin/main` → true. The apiKey commit really is already
  public; this isn't a theoretical exposure someone's guessing at.
- Staged the real 7 modified files and ran `.githooks/pre-commit` directly (not just the test
  suite) against the actual staged content — exit 0. Then ran `.githooks/test-pre-commit.sh` — 11/11.
  Then a full-tree grep for the apiKey and app-id regexes across every tracked file — zero hits.
  Then unstaged again (`git reset`) since committing isn't mine to do unilaterally, and I wanted the
  tree left as I found it until Badrish's word arrives.
- `git push --dry-run origin main` → `5da2840..cd682b2 main -> main`, clean fast-forward, no
  rejection. This only exercises the 9 already-committed commits — it does **not** cover the 7
  uncommitted files, which is exactly why the proposal has to be commit-then-push, not push alone.
- `git status --porcelain` for untracked files → none. The 7 modified files are the entire
  uncommitted set; nothing is hiding outside it.

### The one judgment call I made: commit is inside the green light

Badrish's word is the trigger for the push — that's the sensitive, public, one-way action. The
commit that precedes it is none of those things: it's local, fully reversible (`git reset` undoes
it cleanly, I proved that to myself by doing exactly that), and it's what makes the push worth
anything — a push without it ships the tree with the appId still sitting in ticket 04. I recommended
bundling commit+push as one approved sequence rather than making Badrish approve twice for
something where only the second half is actually irreversible. Said so plainly in the proposal
rather than leaving it as an open question for him to resolve — that's the whole point of a
one-word-approvable proposal.

## 2026-08-27 — second session: `.gitattributes`

Brought in for one thing: Badrish asked for `.gitattributes` for LF normalisation. Read the top of
`JOURNAL.md`, `features/deploy-pipeline.md`, and this file first — confirmed the push from the last
session actually landed (`main` and `origin/main` both at `c70a301`) rather than trusting the
Builder's "the push went through" as given; `git log --oneline -5 origin/main` matched local exactly.

### What I found before writing anything

`git config core.autocrlf` → `true`. No `.gitattributes` existed. `git ls-files --eol` across the
whole tree turned up the real version of the risk the Builder described, not a hypothetical one:
`.agents/features/editor-and-shell.md` and `.scratch/notes-mvp/issues/04-provision-accounts.md`
already had `w/crlf` working copies on this machine right now, despite `i/lf` in the index —
autocrlf had already drifted two tracked files. `.githooks/pre-commit` itself was still `w/lf` at
that moment, but nothing was protecting it from the same drift on the next checkout.

### The rule: one pattern, not two

`* text=auto eol=lf` for everything, `*.png binary` for the icons, rather than scoping the forced-LF
rule to `.githooks/*`/`*.sh`. Wrote the reasoning onto the feature file's Decisions section: a
narrowly-scoped pattern is precisely the shape that's bitten this project twice already (the ESLint
boundary rule, the pre-commit app-id gap) — correct for what it's tested against, silently wrong for
whatever's added next and not on the list. `text=auto` alone only normalises repo storage, not
checkout — it's `eol=lf` specifically that forces the working tree regardless of `core.autocrlf`,
which is the actual property `.githooks/*` needs.

### Verified both directions, not asserted

- `git check-attr text eol` on `.githooks/*`, `src/main.tsx`, `package.json`, `.agents/JOURNAL.md`
  → all `text: auto`, `eol: lf`.
- Negative control: the three PNGs report `binary: set`, `text: unset` (via the `binary` macro's
  `-text`). `check-attr` still echoes `eol: lf` for them cosmetically because `eol` isn't cleared by
  the macro — that's a real gap in what `check-attr` alone would prove, so I didn't stop there.
- The real proof: `git add --renormalize .` on the clean tree staged nothing but the new
  `.gitattributes` file itself. Every tracked blob, PNGs included, came back byte-identical
  (`git hash-object` on `icon-192.png` matched before and after). Nothing was stored with the wrong
  ending, so no renormalisation commit is needed, and the binary exclusion is proven inert on the
  actual bytes, not just claimed inert from the attribute table.
- Reproduced the failure mode live: removed the two already-drifted files and re-checked them out
  after adding `.gitattributes` — both came back `w/lf`. `eol=lf` overriding this machine's
  `core.autocrlf=true`, demonstrated on this checkout, not just read out of git's docs.

Committed alone (`a4e8862`) — the `.gitattributes` addition is the only functional change in that
commit; the logbook updates are a separate commit so nothing rides in silently alongside it. Did not
push; that's Badrish's call same as last session.

### Nothing found wrong with the Builder's brief

This brief carried one claim worth checking rather than trusting outright: "the push went through,
`5da2840..c70a301`, fast-forward." Checked it against `git log --oneline -5 origin/main` before
building anything on top of it — it matched local exactly, so the push really had landed and I
wasn't about to add `.gitattributes` against a stale assumption of where `origin/main` sat. No
corrections owed back to him on it.

## 2026-09-01 — third session: verifying the first-ever Pages deploy over HTTP

Brought in to confirm `note-maker-f41.pages.dev` actually serves 47fb198 with the five env vars
live, not to assume Badrish's "it's set up" is correct. No browser available; did it all with
`curl`/`WebFetch` plus a local build for comparison.

### Tying the deploy to the commit

`npm ci` (fresh, matching lockfile) + `npm run build` at HEAD `47fb198`, using the existing
`.env.local` (known placeholder — see dead end below). Compared every asset the deployed
`index.html`/`sw.js` reference against the local `dist/`:

- **Byte-identical, deployed vs. local:** `manifest.webmanifest`, `assets/index-BXa1njak.css`,
  `assets/workbox-window.prod.es5-Bd17z0YL.js`, `workbox-2fbc6a65.js`, all three PNG icons
  (md5-matched). None of these are env-dependent, so an exact match across two different build
  environments is strong evidence of the same source tree, not coincidence.
- **`index.html` differs in exactly one line** — the JS `<script src>` — and nothing else (explicit
  `diff`). The JS filename differs because Vite inlines `import.meta.env.VITE_FIREBASE_*` into the
  bundle and content-hashes it; my local build used placeholder values, Cloudflare's used the real
  ones, so a different JS hash is *expected*, not evidence of a stale deploy. Confirmed this is the
  actual mechanism by finding the inlined `io()` env object in both bundles.
- Conclusion: the live site is serving this commit, built with different (real) env values than my
  local placeholder ones. Confidence is high — six independent files matched byte-for-byte and the
  one that didn't has a specific, verified, non-alarming reason.

### Env vars reached the build, and they're not placeholder-shaped

Extracted the inlined env object from the deployed bundle by regex and checked **presence, length,
and shape only** — never printed a captured value. All four `VITE_FIREBASE_*` names present,
non-empty, not the literal string `undefined`; `apiKey` matches `/^AIza[0-9A-Za-z_-]{35}$/`,
`appId` matches Firebase's `n:n:web:hex` shape, `authDomain`/`projectId` equal the expected
`notemaker-claude.firebaseapp.com` / `notemaker-claude` (boolean equality check, not printed). The
boot guard (`readConfig`) would not trip. Strict shape matches rule out placeholder values — a
placeholder wouldn't pass the `AIza...` or appId regex.

**Negative control, not just asserted:** rebuilt locally with all four `VITE_FIREBASE_*` vars
unset (`env -u ...`), ran the identical extraction script against that bundle — it correctly
reported all four as absent from the inlined object (which collapsed to just
`{BASE_URL,DEV,MODE,PROD,SSR}`). So the presence check has teeth; it isn't matching everything by
construction.

### Dead end / mistake to not repeat: printed the local placeholder credential into the transcript

While reasoning out *how* Vite inlines `import.meta.env` (the source uses dynamic `env[key]`
lookup, not static dot-access, so I wasn't certain Vite would still fully replace it), I dumped
~800 chars of the **local** built JS around the `readConfig` function using Python, to see the
construction. That printed the local `.env.local` placeholder `apiKey`/`appId`/`authDomain`/
`projectId` literally into the tool output. The `authDomain`/`projectId` are already-known,
non-secret identifiers (stated as such in the ticket and in my own task brief), and the `apiKey`/
`appId` are the confirmed-fake local placeholder (established in the 2026-08-27 entry as failing
sign-in with `auth/api-key-not-valid`) — not the real deployed credential. But the instruction was
absolute and I should have designed the extraction script *first* and never let a raw value reach
stdout at all, real or placeholder. Corrected immediately: every check against the **real deployed**
bundle after that point went through a script that only prints booleans/lengths, never the matched
string. Worth remembering: when curiosity about *mechanism* meets a value that might be
credential-shaped, write the diagnostic script blind (regex + length/boolean output) before ever
looking at raw content, even content you expect to be fake.

### Service worker / caching

`sw.js`, `workbox-2fbc6a65.js`, `manifest.webmanifest`, and the three icons all serve at the root
with correct content-types (`application/javascript`, `application/manifest+json`, `image/png`) —
confirmed against a real negative control: a nonexistent path returns Cloudflare Pages' SPA
fallback (`text/html`, `index.html` content), so the correct content-types above are meaningful,
not coincidental routing. Precache manifest in `sw.js` lists real assets with revision hashes that
match the local build exactly for every env-independent file.

**Caching gap, minor:** every asset — including the content-hashed `/assets/*.js`/`*.css` that
never need to change under a fixed filename — is served `Cache-Control: public, max-age=0,
must-revalidate`. No `_headers` file exists to override Cloudflare Pages' default. Not a staleness
bug (ETag + must-revalidate means a conditional GET always gets fresh content, never silently
stale), just a missed opportunity to `immutable`-cache the hashed assets. Not flagging as urgent.

**Also noted, not urgent:** `/assets/<nonexistent>.js` returns Cloudflare's SPA fallback (200,
HTML) rather than a 404 — inherent to Pages' default routing, not something this ticket configured
wrong. Means a client requesting a hashed asset that no longer exists on the current production
deployment gets a JS parse error instead of a clean 404. Edge case, not observed to matter here.
No HSTS header present (HTTP still 301s to HTTPS, so not a functional gap) — a one-toggle
Cloudflare dashboard setting if Badrish wants it, unrelated to this ticket's five env vars.

### Not verifiable from here

Preview-environment env vars (no non-`main` branch exists to deploy and check); Firestore rules
actually deployed (`npm run rules:deploy` is a manual step with Firebase CLI credentials, nothing
to check over HTTP); real `signInWithPopup` flow (Badrish is checking that himself in a browser,
per his own note in the task).

Left the tree exactly as found: `npm ci` + two builds (`dist/`, `dist-negctrl/`) all gitignored;
`dist-negctrl/` removed after use; `.env.local` renamed and restored (532 bytes before and after,
untouched). `git status` clean at `47fb198` before and after.

## 2026-09-01 — fourth session: record correction, and the second push

Brought in for two things in order: correct three stale documents now that Badrish confirmed (his
words, "rotated and retired") the apiKey exposure is closed, then commit and push — this time with
explicit authorisation to run `git push` myself, unlike the first session where I only prepared the
proposal.

### What I corrected, and what I deliberately didn't touch

Three files: `.agents/features/deploy-pipeline.md` (moved the resolved fact from Open Questions into
Decisions, left Open Questions empty), `.scratch/notes-mvp/issues/04-provision-accounts.md` (rewrote
the section heading and body that still framed rotation as pending), `.scratch/notes-mvp/issues/10-deploy-pipeline.md`
(corrected a note stale on two axes — it said the public tip still held the literal key, which the
2026-08-27 push had already fixed, and that only rotation remained, which is now done). Ran the grep
sweep across `.agents` and `.scratch` first rather than trusting the brief's list of three was
exhaustive — it wasn't wrong, but I checked rather than assumed. Everything else that matched
"rotat|revok|retire" was either the unrelated `deviceId` rotation in the sync engine, or lines inside
`.agents/JOURNAL.md`/`.agents/notes/builder.md` that are not mine to edit and were correctly left
alone.

The one judgment call: attribution wording. The brief was explicit that this is Badrish's assertion,
not a console check, and that the difference has to survive to someone reading cold in three months.
I wrote "confirmed by Badrish, 2026-09-01" plus an explicit "not a console check performed by any
agent" sentence in all three places rather than a single soft "resolved" — redundant across three
files, but the failure mode being guarded against (an open question closed by bare assertion with no
record of who or how) is exactly what this task existed to fix, so I didn't economize on it.

### Commit, then push, both mine this session

Staged exactly the three files (`git status --porcelain` after `git add` showed nothing else picked
up). Pre-commit hook ran and passed — no credential-shaped content, nothing to route back to
Badrish about a hook failure. Committed at `2871193`.

Pre-flighted the push properly rather than trusting the numbers in my brief, which were stated as
"minutes old, don't rely on it": `git fetch origin` immediately before pushing, confirmed
`origin/main` (`47fb198`) was still an ancestor of local `main` before running `git push`. Pushed
clean fast-forward `47fb198..2871193`. Fetched again after and confirmed `origin/main` now equals
local `main` at `2871193` — didn't take the push command's own success output as sufficient, checked
the remote state independently.
