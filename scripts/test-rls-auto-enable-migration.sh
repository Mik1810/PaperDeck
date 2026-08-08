#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
migration="$repo_root/supabase/migrations/20260808221535_restrict_rls_auto_enable_execution.sql"
if command -v initdb >/dev/null 2>&1; then
  postgres_bin=$(dirname "$(command -v initdb)")
else
  postgres_bin=$(find /usr/lib/postgresql -path '*/bin/initdb' -type f -printf '%h\n' 2>/dev/null | sort -V | tail -n 1)
fi
if [[ -z "$postgres_bin" ]]; then
  printf 'PostgreSQL server binaries are required (initdb, pg_ctl, psql).\n' >&2
  exit 1
fi
test_root=$(mktemp -d /tmp/paperdeck-rls-auto-enable.XXXXXX)
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

"$postgres_bin/psql" "${psql_args[@]}" >/dev/null <<'SQL'
create role anon nologin;
create role authenticated nologin;

create function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  command record;
begin
  for command in select * from pg_event_trigger_ddl_commands()
  loop
    if command.command_tag = 'CREATE TABLE'
       and command.schema_name = 'public' then
      execute format('alter table %s enable row level security', command.object_identity);
    end if;
  end loop;
end;
$$;

create event trigger paperdeck_test_rls_auto_enable
on ddl_command_end
when tag in ('CREATE TABLE')
execute function public.rls_auto_enable();

grant execute on function public.rls_auto_enable() to public, anon, authenticated;
SQL

"$postgres_bin/psql" "${psql_args[@]}" -f "$migration" >/dev/null

"$postgres_bin/psql" "${psql_args[@]}" >/dev/null <<'SQL'
do $$
declare
  public_can_execute boolean;
  trigger_enabled "char";
begin
  select exists (
    select 1
    from pg_proc procedure
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) privilege
    where procedure.oid = 'public.rls_auto_enable()'::regprocedure
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) into public_can_execute;

  if public_can_execute
     or has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE') then
    raise exception 'API execution privileges were not fully revoked';
  end if;

  select evtenabled
  into trigger_enabled
  from pg_event_trigger
  where evtname = 'paperdeck_test_rls_auto_enable';

  if trigger_enabled is distinct from 'O' then
    raise exception 'The automatic RLS event trigger is missing or disabled';
  end if;
end;
$$;

create table public.rls_auto_enable_probe (id bigint primary key);

do $$
begin
  if not (
    select relrowsecurity
    from pg_class
    where oid = 'public.rls_auto_enable_probe'::regclass
  ) then
    raise exception 'The event trigger no longer enables RLS';
  end if;
end;
$$;

drop table public.rls_auto_enable_probe;
drop event trigger paperdeck_test_rls_auto_enable;
drop function public.rls_auto_enable();
SQL

# The migration must also be safe where Supabase has not installed the helper.
"$postgres_bin/psql" "${psql_args[@]}" -f "$migration" >/dev/null

printf 'RLS auto-enable migration test passed.\n'
