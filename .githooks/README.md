# Git hooks

Hooks live here rather than in `.git/hooks` so they are version-controlled and travel with the
repo. Git does not pick them up automatically. **After cloning, run once:**

```bash
git config core.hooksPath .githooks
```

## `pre-commit`

Refuses to commit staged content containing credential-shaped strings (Google/Firebase API keys,
GitHub/GitLab/npm/Slack/AWS/Anthropic tokens, PEM private key blocks, service-account JSON, signed
JWTs), and refuses a real `.env`.

It exists because this repo is public and `.scratch/` — the wayfinder tickets — is committed on
purpose. That is the right call, tickets are the decision record, but it means anything pasted into
a ticket is published. `.gitignore` closes the `.env` route; this closes the "typed it into a
document" route, which is how the Firebase web API key reached `origin/main` on 2026-08-25.

Escape hatches, in order of preference:

1. Put the real value somewhere else and commit a pointer to it. This is almost always the answer.
2. Append `pragma: allowlist secret` to the line, if it is a genuine placeholder that has to look
   like the real thing.
3. `git commit --no-verify` — deliberate, and on you.

## Tests

```bash
sh .githooks/test-pre-commit.sh
```

Every "this is blocked" case is paired with a negative control, because a scanner that matches
nothing and a repo that contains nothing look identical from the outside.
