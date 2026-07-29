create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create type public.research_group_role as enum (
  'owner',
  'admin',
  'member'
);

create type public.research_group_state as enum (
  'active',
  'archived'
);

create table private.research_group_runtime_settings (
  singleton boolean primary key default true check (singleton),
  reads_enabled boolean not null default false,
  writes_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into private.research_group_runtime_settings (
  singleton,
  reads_enabled,
  writes_enabled
) values (true, false, false);

create table public.research_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text check (
    description is null or char_length(description) <= 500
  ),
  state public.research_group_state not null default 'active',
  selected_successor_id text references public.profiles(owner_id)
    on delete set null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (
    (state = 'active' and archived_at is null)
    or (state = 'archived' and archived_at is not null)
  )
);

create index research_groups_selected_successor_idx
  on public.research_groups (selected_successor_id)
  where selected_successor_id is not null;

create table public.research_group_members (
  group_id uuid not null references public.research_groups(id)
    on delete cascade,
  member_id text not null references public.profiles(owner_id)
    on delete cascade,
  role public.research_group_role not null,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (group_id, member_id),
  check (role <> 'owner' or revoked_at is null)
);

create unique index research_group_one_active_owner_idx
  on public.research_group_members (group_id)
  where role = 'owner' and revoked_at is null;

create index research_group_members_active_member_idx
  on public.research_group_members (member_id, group_id)
  where revoked_at is null;

create index research_group_members_member_fk_idx
  on public.research_group_members (member_id);

create index research_group_members_succession_idx
  on public.research_group_members (
    group_id,
    role,
    joined_at,
    member_id
  )
  where revoked_at is null;

alter table public.research_groups enable row level security;
alter table public.research_group_members enable row level security;

create or replace function private.research_groups_reads_enabled()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private
as $$
  select coalesce((
    select settings.reads_enabled
    from private.research_group_runtime_settings as settings
    where settings.singleton
  ), false);
$$;

create or replace function private.research_group_is_active_member(
  p_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    nullif(auth.jwt() ->> 'sub', '') is not null
    and exists (
      select 1
      from public.research_group_members as membership
      where membership.group_id = p_group_id
        and membership.member_id = auth.jwt() ->> 'sub'
        and membership.revoked_at is null
    );
$$;

create policy research_groups_active_member_read
  on public.research_groups
  for select
  to authenticated
  using (
    state = 'active'
    and (select private.research_groups_reads_enabled())
    and (select private.research_group_is_active_member(id))
  );

create policy research_group_members_self_read
  on public.research_group_members
  for select
  to authenticated
  using (
    member_id = auth.jwt() ->> 'sub'
    and revoked_at is null
    and (select private.research_groups_reads_enabled())
  );

create or replace function private.enforce_research_group_invariants()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  affected_group_id uuid;
  successor_id text;
begin
  if tg_table_name = 'research_groups' then
    affected_group_id := coalesce(new.id, old.id);
  else
    affected_group_id := coalesce(new.group_id, old.group_id);
  end if;

  if not exists (
    select 1 from public.research_groups
    where id = affected_group_id
  ) then
    return null;
  end if;

  if (
    select count(*)
    from public.research_group_members
    where group_id = affected_group_id
      and role = 'owner'
      and revoked_at is null
  ) <> 1 then
    raise exception 'research_group_requires_exactly_one_owner'
      using errcode = '23514';
  end if;

  select selected_successor_id
  into successor_id
  from public.research_groups
  where id = affected_group_id;

  if successor_id is not null and not exists (
    select 1
    from public.research_group_members
    where group_id = affected_group_id
      and member_id = successor_id
      and role <> 'owner'
      and revoked_at is null
  ) then
    raise exception 'research_group_successor_must_be_active_non_owner'
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger research_groups_invariants
after insert or update on public.research_groups
deferrable initially deferred
for each row execute function private.enforce_research_group_invariants();

create constraint trigger research_group_members_invariants
after insert or update or delete on public.research_group_members
deferrable initially deferred
for each row execute function private.enforce_research_group_invariants();

create or replace function public.handle_research_group_account_closure(
  p_owner_id text
)
returns table (
  groups_transferred integer,
  groups_deleted integer,
  memberships_removed integer
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  owned_group record;
  successor_id text;
  transferred_count integer := 0;
  deleted_count integer := 0;
  removed_count integer := 0;
  affected_count integer := 0;
begin
  if p_owner_id is null or btrim(p_owner_id) = '' then
    raise exception 'account_owner_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('research-group-account-closure', 0)
  );

  for owned_group in
    select groups.id, groups.selected_successor_id
    from public.research_groups as groups
    join public.research_group_members as owner_membership
      on owner_membership.group_id = groups.id
     and owner_membership.member_id = p_owner_id
     and owner_membership.role = 'owner'
     and owner_membership.revoked_at is null
    order by groups.id
    for update of groups
  loop
    successor_id := null;

    if owned_group.selected_successor_id is not null then
      select membership.member_id
      into successor_id
      from public.research_group_members as membership
      where membership.group_id = owned_group.id
        and membership.member_id = owned_group.selected_successor_id
        and membership.role <> 'owner'
        and membership.revoked_at is null;
    end if;

    if successor_id is null then
      select membership.member_id
      into successor_id
      from public.research_group_members as membership
      where membership.group_id = owned_group.id
        and membership.member_id <> p_owner_id
        and membership.role in ('admin', 'member')
        and membership.revoked_at is null
      order by
        case membership.role when 'admin' then 0 else 1 end,
        membership.joined_at,
        membership.member_id
      limit 1
      for update;
    end if;

    if successor_id is null then
      delete from public.research_groups
      where id = owned_group.id;
      deleted_count := deleted_count + 1;
      removed_count := removed_count + 1;
    else
      update public.research_groups
      set
        selected_successor_id = null,
        revision = revision + 1,
        updated_at = now()
      where id = owned_group.id;

      delete from public.research_group_members
      where group_id = owned_group.id
        and member_id = p_owner_id;

      update public.research_group_members
      set
        role = 'owner',
        updated_at = now()
      where group_id = owned_group.id
        and member_id = successor_id
        and revoked_at is null;

      transferred_count := transferred_count + 1;
      removed_count := removed_count + 1;
    end if;
  end loop;

  update public.research_groups
  set
    selected_successor_id = null,
    revision = revision + 1,
    updated_at = now()
  where selected_successor_id = p_owner_id;

  delete from public.research_group_members
  where member_id = p_owner_id;
  get diagnostics affected_count = row_count;
  removed_count := removed_count + affected_count;

  return query
  select transferred_count, deleted_count, removed_count;
end;
$$;

revoke all on table private.research_group_runtime_settings
  from public, anon, authenticated;
revoke all on function private.research_groups_reads_enabled()
  from public, anon;
revoke all on function private.research_group_is_active_member(uuid)
  from public, anon;
revoke all on function private.enforce_research_group_invariants()
  from public, anon, authenticated;
revoke all on function public.handle_research_group_account_closure(text)
  from public, anon, authenticated;

grant usage on schema private to authenticated;
grant execute on function private.research_groups_reads_enabled()
  to authenticated;
grant execute on function private.research_group_is_active_member(uuid)
  to authenticated;

revoke all on table public.research_groups
  from public, anon, authenticated;
revoke all on table public.research_group_members
  from public, anon, authenticated;
grant select on table public.research_groups to authenticated;
grant select on table public.research_group_members to authenticated;

grant select, insert, update, delete
  on table public.research_groups to service_role;
grant select, insert, update, delete
  on table public.research_group_members to service_role;
grant execute on function public.handle_research_group_account_closure(text)
  to service_role;

comment on table public.research_groups is
  'Private research-group metadata. Existing private playlists are never converted into groups.';
comment on table public.research_group_members is
  'Private group ACL. Exactly one active owner is enforced transactionally.';
comment on function public.handle_research_group_account_closure(text) is
  'Service-role-only deterministic ownership succession for a deleted Clerk account.';
