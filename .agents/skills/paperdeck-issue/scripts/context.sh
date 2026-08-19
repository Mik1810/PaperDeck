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
docker_ready=0
if ! command -v docker >/dev/null 2>&1; then
  echo "docker: unavailable"
elif command -v timeout >/dev/null 2>&1; then
  if timeout 2s docker info >/dev/null 2>&1; then
    docker_ready=1
    echo "docker: ready"
  else
    echo "docker: daemon-unavailable"
  fi
else
  # Do not risk an unbounded daemon probe just to discover local validation capability.
  echo "docker: probe-unavailable"
fi

if [[ "$docker_ready" -eq 1 ]]; then
  echo "paperdeck_local_e2e_db: available"
  echo "paperdeck_local_db_prereq: available"

  # Resolve the currently published canonical database endpoint once. This is
  # intentionally credential-free: agents can avoid stale hard-coded ports
  # without printing DATABASE_URL or local passwords into model context.
  db_endpoint=""
  if command -v timeout >/dev/null 2>&1; then
    db_endpoint="$(timeout 3s docker compose port database 5432 2>/dev/null | head -n 1 || true)"
  fi
  if [[ -n "$db_endpoint" ]]; then
    case "$db_endpoint" in
      0.0.0.0:*) db_endpoint="127.0.0.1:${db_endpoint#0.0.0.0:}" ;;
      \[::\]:*) db_endpoint="127.0.0.1:${db_endpoint#\[::\]:}" ;;
    esac
    printf 'paperdeck_test_db_endpoint: %s/paperdeck_test\n' "$db_endpoint"
    echo "paperdeck_test_db_endpoint_source: docker-compose"
  else
    echo "paperdeck_test_db_endpoint: not-running-or-unresolved"
  fi
else
  echo "paperdeck_local_e2e_db: blocked"
  echo "paperdeck_local_db_prereq: blocked"
  echo "paperdeck_test_db_endpoint: blocked"
fi

echo "e2e_preflight_policy: if blocked, skip browser/E2E setup unless the issue itself requires diagnosing that infrastructure"
echo "db_preflight_policy: if blocked, do not probe system PostgreSQL, alternate ports/users/clusters, Podman/nerdctl, or ad-hoc databases; record the canonical local-DB blocker once"
echo "db_target_policy: run DB-writing tests/benchmarks through scripts/pd-db-run; it forces the current canonical Docker paperdeck_test target and refuses hosted targets"
echo "db_secret_policy: never print a full DATABASE_URL or database credentials into model context"

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
