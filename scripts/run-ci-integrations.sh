#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
database_url="${PAPERDECK_TEST_DATABASE_URL:-${DATABASE_URL:-}}"

if [[ -z "$database_url" ]]; then
  printf 'PAPERDECK_TEST_DATABASE_URL or DATABASE_URL is required.\n' >&2
  exit 1
fi

DATABASE_URL="$database_url" node -e '
  const url = new URL(process.env.DATABASE_URL);
  const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

  if (!localHosts.has(url.hostname) || url.pathname !== "/paperdeck_test") {
    throw new Error(
      "Deterministic integration tests may only use localhost/paperdeck_test.",
    );
  }
'

export DATABASE_URL="$database_url"
export PAPERDECK_RUN_ARXIV_BUNDLE_INTEGRATION=true
export PAPERDECK_RUN_CLASSIC_BUNDLE_INTEGRATION=true
export PAPERDECK_RUN_CATALOG_SEARCH_INTEGRATION=true
export PAPERDECK_RUN_GROUP_INVITES_INTEGRATION=true
export PAPERDECK_RUN_LIBRARY_INTEGRATION=true
export PAPERDECK_RUN_NOTIFICATIONS_INTEGRATION=true
export PAPERDECK_RUN_PROFILE_BOOTSTRAP_INTEGRATION=true
export PAPERDECK_RUN_RECOMMENDATION_RETENTION_INTEGRATION=true
export PAPERDECK_RUN_RUNTIME_POOL_INTEGRATION=true

cd "$repo_root"

exec node \
  --conditions react-server \
  --import tsx \
  --test \
  --test-concurrency=1 \
  tests/integration/arxiv-paper-bundle.test.ts \
  tests/integration/classic-paper-bundle.test.ts \
  tests/integration/catalog-search-pagination.test.ts \
  tests/integration/clerk-user-deletion-lifecycle.test.ts \
  tests/integration/database-runtime-pool.test.ts \
  tests/integration/friendships-rls.test.ts \
  tests/integration/library-pagination.test.ts \
  tests/integration/notifications.test.ts \
  tests/integration/profile-bootstrap-lifecycle.test.ts \
  tests/integration/recommendation-analytics-retention.test.ts \
  tests/integration/research-group-invitations.test.ts \
  tests/integration/research-groups-rls.test.ts
