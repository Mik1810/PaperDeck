#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <github-issue-number>" >&2
  exit 2
fi

issue="$1"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required" >&2
  exit 1
fi

root="$(git rev-parse --show-toplevel)"
cd "$root"

echo "== repository =="
printf 'root: %s\n' "$root"
printf 'branch: %s\n' "$(git branch --show-current)"
printf 'head: %s\n' "$(git log -1 --pretty='%h %s')"

echo
echo "== working tree =="
git status --short
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo
  git diff --stat
fi

echo
echo "== issue #$issue =="
if command -v gh >/dev/null 2>&1; then
  gh issue view "$issue" \
    --json number,title,state,labels,body,url \
    --jq '"#\(.number) \(.title)\nstate: \(.state)\nlabels: \([.labels[].name] | join(", "))\nurl: \(.url)\n\n\(.body)"'
else
  echo "gh not installed; open issue #$issue with the GitHub connector/UI."
fi

echo
echo "== recent commits =="
git log -5 --pretty='format:%h %ad %s' --date=short

echo
echo "== recent session logs =="
if [[ -d sessions ]]; then
  find sessions -maxdepth 1 -type f -name 'SESSION*.md' -printf '%f\n' 2>/dev/null \
    | sort -V | tail -n 3
else
  echo "(no sessions directory)"
fi

echo
echo "Next: read PROJECT_STATE.md, then search only for symbols/files relevant to the issue."
