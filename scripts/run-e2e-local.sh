#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
default_url='postgresql://paperdeck:paperdeck_local_only@127.0.0.1:55432/paperdeck_test'

cd "$repo_root"

if [[ "${CI:-}" != "true" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    printf 'Docker is required. Enable Docker Desktop WSL integration, then retry.\n' >&2
    exit 1
  fi
  docker compose up -d --wait database
fi

export PAPERDECK_LOCAL_DATABASE_URL="${PAPERDECK_LOCAL_DATABASE_URL:-${DATABASE_URL:-$default_url}}"
export DATABASE_URL="$PAPERDECK_LOCAL_DATABASE_URL"
export DATABASE_MAX_CONNECTIONS="${DATABASE_MAX_CONNECTIONS:-3}"
export NEXT_PUBLIC_PAPERDECK_DEV_AUTH="${NEXT_PUBLIC_PAPERDECK_DEV_AUTH:-true}"
export PAPERDECK_E2E_DEV_AUTH="${PAPERDECK_E2E_DEV_AUTH:-true}"
export PAPERDECK_E2E_OWNER_ID="${PAPERDECK_E2E_OWNER_ID:-playwright-user}"
export TMPDIR=/tmp

"$repo_root/node_modules/.bin/tsx" scripts/local-database.ts prepare-test
exec "$repo_root/node_modules/.bin/playwright" test "$@"
