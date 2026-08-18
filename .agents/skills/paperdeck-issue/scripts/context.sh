#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <github-issue-number>" >&2
  exit 2
fi

issue="$1"
root="$(git rev-parse --show-toplevel)"
cd "$root"

echo "== repository =="
printf 'root: %s\n' "$root"
printf 'branch: %s\n' "$(git branch --show-current)"
printf 'head: %s\n' "$(git log -1 --pretty='%h %s')"
echo "worktree_policy: main-checkout-only"
echo "branch_policy: dedicated-issue-branch-no-codex-prefix"

echo
echo "== working tree =="
if [[ -n "$(git status --porcelain)" ]]; then
  echo "WARNING: working tree has uncommitted changes."
  echo "Do not stash/discard/move unrelated changes automatically."
  git status --short
  echo
  git diff --stat
else
  echo "clean"
fi

echo
echo "== local validation preflight =="
if ! command -v docker >/dev/null 2>&1; then
  echo "docker: unavailable"
  echo "paperdeck_local_e2e_db: blocked"
elif command -v timeout >/dev/null 2>&1; then
  if timeout 2s docker info >/dev/null 2>&1; then
    echo "docker: ready"
    echo "paperdeck_local_e2e_db: available"
  else
    echo "docker: daemon-unavailable"
    echo "paperdeck_local_e2e_db: blocked"
  fi
elif docker info >/dev/null 2>&1; then
  echo "docker: ready"
  echo "paperdeck_local_e2e_db: available"
else
  echo "docker: daemon-unavailable"
  echo "paperdeck_local_e2e_db: blocked"
fi
echo "e2e_preflight_policy: if blocked, skip browser/E2E setup unless the issue itself requires diagnosing that infrastructure"

echo
echo "== issue #$issue =="
if command -v gh >/dev/null 2>&1; then
  gh issue view "$issue" \
    --json number,title,state,labels,body,url \
    --jq '"#\(.number) \(.title)\nstate: \(.state)\nlabels: \([.labels[].name] | join(", "))\nurl: \(.url)\n\n\(.body)"'
else
  echo "gh not installed; use the GitHub connector/UI for issue #$issue."
fi

echo
echo "== recent commits =="
git log -3 --pretty='format:%h %ad %s' --date=short

echo
echo "Next: read PROJECT_STATE.md alone, then perform a focused issue-relevant search."
