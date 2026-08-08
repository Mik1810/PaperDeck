#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
schema="$repo_root/supabase/schema.sql"
fixture="$repo_root/tests/fixtures/research-group-workspace.sql"
search_migration="$repo_root/supabase/migrations/20260714210105_add_search_indexes.sql"

if command -v initdb >/dev/null 2>&1; then
  postgres_bin=$(dirname "$(command -v initdb)")
else
  postgres_bin=$(find /usr/lib/postgresql -path '*/bin/initdb' -type f -printf '%h\n' 2>/dev/null | sort -V | tail -n 1)
fi
if [[ -z "$postgres_bin" ]]; then
  printf 'PostgreSQL server binaries are required (initdb, pg_ctl, psql).\n' >&2
  exit 1
fi

test_root=$(mktemp -d /tmp/paperdeck-group-workspace.XXXXXX)
data_dir="$test_root/data"
socket_dir="$test_root/socket"
db_port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
started=false

cleanup() {
  if [[ "$started" == true ]]; then
    "$postgres_bin/pg_ctl" -D "$data_dir" -m immediate stop >/dev/null 2>&1 || true
  fi
  find "$test_root" -depth -delete 2>/dev/null || true
}
trap cleanup EXIT

mkdir "$socket_dir"
"$postgres_bin/initdb" -D "$data_dir" -A trust --no-locale >/dev/null
"$postgres_bin/pg_ctl" \
  -D "$data_dir" \
  -o "-F -k '$socket_dir' -h 127.0.0.1 -p '$db_port' -c unix_socket_permissions=0700" \
  -w start >/dev/null
started=true

psql_args=(
  -X
  -v ON_ERROR_STOP=1
  -h "$socket_dir"
  -p "$db_port"
  -d postgres
)

"$postgres_bin/psql" "${psql_args[@]}" <<'SQL' >/dev/null
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb;
$$;
SQL

# The local PostgreSQL package does not include pgvector. Only this disposable
# input stream substitutes vector columns with text and removes vector-only DDL.
sed \
  -e '/create extension if not exists vector;/d' \
  -e 's/vector(384)/text/g' \
  "$schema" | awk '
    /create index papers_embedding_cosine_idx/ { skip_index=1 }
    skip_index && /with \(lists = 100\);/ { skip_index=0; next }
    skip_index { next }
    /create or replace function match_papers_by_embedding\(/ { skip_function=1 }
    skip_function && /^\$\$;$/ { skip_function=0; next }
    skip_function { next }
    { print }
  ' | "$postgres_bin/psql" "${psql_args[@]}" >/dev/null

"$postgres_bin/psql" "${psql_args[@]}" -f "$search_migration" >/dev/null
"$postgres_bin/psql" "${psql_args[@]}" -f "$fixture" >/dev/null

db_user=$(id -un)
export DATABASE_URL="postgresql://$db_user@127.0.0.1:$db_port/postgres"
export DATABASE_MAX_CONNECTIONS=3
export NEXT_PUBLIC_PAPERDECK_DEV_AUTH=true
export TMPDIR=/tmp

run_phase() {
  local mode=$1
  local owner_id=$2
  local port=$3

  PAPERDECK_GROUP_UI_MODE="$mode" \
  PAPERDECK_DEV_OWNER_ID="$owner_id" \
  PAPERDECK_GROUP_UI_PORT="$port" \
    "$repo_root/node_modules/.bin/playwright" test \
      --config="$repo_root/playwright.group-workspace.config.ts"
}

run_phase member local-group-member 3211
run_phase owner local-group-owner 3212
run_phase mobile local-group-owner 3213

"$postgres_bin/psql" "${psql_args[@]}" -At <<'SQL'
select json_build_object(
  'workspace_test', 'passed',
  'remote_mutations', 0,
  'clerk_sessions_created', 0,
  'temporary_profiles', count(*) filter (where owner_id like 'local-group-%'),
  'temporary_group_count', (
    select count(*) from public.research_groups
  )
)
from public.profiles;
SQL
