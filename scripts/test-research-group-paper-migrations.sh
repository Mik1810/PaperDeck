#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
baseline="$repo_root/tests/fixtures/research-group-papers-baseline.sql"
migration_schema="$repo_root/supabase/migrations/20260808225719_add_research_group_shared_papers.sql"
migration_operations="$repo_root/supabase/migrations/20260808230008_wire_research_group_shared_paper_operations.sql"

if command -v initdb >/dev/null 2>&1; then
  postgres_bin=$(dirname "$(command -v initdb)")
else
  postgres_bin=$(find /usr/lib/postgresql -path '*/bin/initdb' -type f -printf '%h\n' 2>/dev/null | sort -V | tail -n 1)
fi
if [[ -z "$postgres_bin" ]]; then
  printf 'PostgreSQL server binaries are required (initdb, pg_ctl, psql).\n' >&2
  exit 1
fi

test_root=$(mktemp -d /tmp/paperdeck-group-papers.XXXXXX)
data_dir="$test_root/data"
socket_dir="$test_root/socket"
started=false

cleanup() {
  if [[ "$started" == true ]]; then
    "$postgres_bin/pg_ctl" -D "$data_dir" -m immediate stop >/dev/null
  fi
  rm -rf -- "$test_root"
}
trap cleanup EXIT

mkdir "$socket_dir"
"$postgres_bin/initdb" -D "$data_dir" -A trust --no-locale >/dev/null
"$postgres_bin/pg_ctl" \
  -D "$data_dir" \
  -o "-F -k '$socket_dir' -c listen_addresses='' -c unix_socket_permissions=0700" \
  -w start >/dev/null
started=true

psql_args=(
  -X
  -v ON_ERROR_STOP=1
  -h "$socket_dir"
  -d postgres
)

"$postgres_bin/psql" "${psql_args[@]}" -f "$baseline" >/dev/null
"$postgres_bin/psql" "${psql_args[@]}" -f "$migration_schema" >/dev/null
"$postgres_bin/psql" "${psql_args[@]}" -f "$migration_operations" >/dev/null

DATABASE_URL=postgresql://isolated.invalid/postgres \
PAPERDECK_RUN_GROUP_PAPERS_INTEGRATION=true \
PAPERDECK_TEST_PGHOST="$socket_dir" \
PAPERDECK_TEST_PGUSER=$(id -un) \
  node --conditions react-server --import tsx --test \
    tests/integration/research-group-papers.test.ts
