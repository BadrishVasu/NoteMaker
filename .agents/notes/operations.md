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
