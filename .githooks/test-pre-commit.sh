#!/bin/sh
# Tests for .githooks/pre-commit.
#
# Run:  sh .githooks/test-pre-commit.sh
#
# A secret scanner that never matches looks exactly like a clean repo, and one
# that matches everything looks exactly like a working scanner until it blocks a
# real commit. So every positive case below is paired with a negative control.
set -u

HOOKS_DIR=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
PASS=0
FAIL=0

# Built at runtime so this test file contains no literal secret-shaped string
# for the hook (or anyone else's scanner) to trip over.
FAKE_GOOGLE_KEY="AIza""SyB1cD3fG4hI5jK6lM7nO8pQ9rS0tU1vW2xY"
FAKE_GH_TOKEN="ghp_""0123456789abcdefghijklmnopqrstuvwxyzAB"
FAKE_AWS_KEY="AKIA""IOSFODNN7EXAMPLE"
FAKE_PEM="-----BEGIN ""RSA PRIVATE KEY-----"

fresh_repo () {
  rm -rf "$WORK/repo"; mkdir -p "$WORK/repo"; cd "$WORK/repo" || exit 1
  git init -q .
  git config user.email t@example.com
  git config user.name Test
  git config commit.gpgsign false
  git config core.hooksPath "$HOOKS_DIR"
  git config core.autocrlf false
}

# expect <blocked|allowed> <label> -- runs `git commit` on whatever is staged
expect () {
  want=$1; label=$2
  out=$(git commit -q -m "test" 2>&1); rc=$?
  if [ "$want" = blocked ]; then got=$( [ $rc -ne 0 ] && echo blocked || echo allowed )
  else got=$( [ $rc -eq 0 ] && echo allowed || echo blocked ); fi
  if [ "$got" = "$want" ]; then
    PASS=$((PASS+1)); printf '  ok    %s\n' "$label"
  else
    FAIL=$((FAIL+1)); printf '  FAIL  %s (wanted %s, got %s)\n%s\n' "$label" "$want" "$got" "$out"
  fi
}

echo "pre-commit hook"

fresh_repo
printf 'apiKey %s\n' "$FAKE_GOOGLE_KEY" > doc.md && git add doc.md
expect blocked "blocks a Google API key in a markdown doc"

fresh_repo
printf 'notes about the apiKey and how referrers work\n' > doc.md && git add doc.md
expect allowed "allows prose that merely talks about keys (negative control)"

fresh_repo
printf 'token: %s\n' "$FAKE_GH_TOKEN" > ci.yml && git add ci.yml
expect blocked "blocks a GitHub personal access token"

fresh_repo
printf 'aws_access_key_id = %s\n' "$FAKE_AWS_KEY" > creds && git add creds
expect blocked "blocks an AWS access key id"

fresh_repo
printf '%s\nMIIhush\n' "$FAKE_PEM" > id.pem && git add id.pem
expect blocked "blocks a PEM private key block"

fresh_repo
printf 'export const port = 5173\n' > app.ts && git add app.ts
expect allowed "allows ordinary source (negative control)"

# The hook must read STAGED content, not the working tree: a secret removed from
# the file but still staged has to be caught, or `git add` then edit slips past.
fresh_repo
printf 'apiKey %s\n' "$FAKE_GOOGLE_KEY" > doc.md && git add doc.md
printf 'apiKey redacted\n' > doc.md
expect blocked "reads staged content, not the working tree"

fresh_repo
printf 'apiKey %s\n' "$FAKE_GOOGLE_KEY" > doc.md && git add doc.md
out=$(git commit -q --no-verify -m t 2>&1); rc=$?
if [ $rc -eq 0 ]; then PASS=$((PASS+1)); printf '  ok    --no-verify still works as the documented escape hatch\n'
else FAIL=$((FAIL+1)); printf '  FAIL  --no-verify escape hatch\n%s\n' "$out"; fi

fresh_repo
printf 'apiKey %s\n' "$FAKE_GOOGLE_KEY" > doc.md && git add doc.md
out=$(git commit -q -m t 2>&1)
case "$out" in
  *doc.md*) PASS=$((PASS+1)); printf '  ok    names the offending file in its output\n' ;;
  *) FAIL=$((FAIL+1)); printf '  FAIL  output does not name the file\n%s\n' "$out" ;;
esac

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
