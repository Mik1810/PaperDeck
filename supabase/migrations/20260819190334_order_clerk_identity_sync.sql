create table private.clerk_user_identity_sync_state (
  owner_id text primary key,
  source_updated_at bigint not null default 0
    check (source_updated_at >= 0),
  account_closed boolean not null default false,
  updated_at timestamptz not null default now()
);

grant usage on schema private to service_role;
revoke all on table private.clerk_user_identity_sync_state
  from public, anon, authenticated;
grant select, insert, update on table private.clerk_user_identity_sync_state
  to service_role;
grant select, insert, update, delete on table public.collaboration_identities
  to service_role;

create or replace function private.sync_clerk_collaboration_identity(
  p_owner_id text,
  p_source_updated_at bigint,
  p_email_lookup_hash text,
  p_email_hash_version integer default 1,
  p_discoverable_by_email boolean default null,
  p_group_invite_policy public.group_invite_policy default null,
  p_allow_same_source_version boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  sync_state private.clerk_user_identity_sync_state%rowtype;
begin
  if p_owner_id is null or btrim(p_owner_id) = '' then
    raise exception 'account_owner_required' using errcode = '22023';
  end if;
  if p_source_updated_at is null or p_source_updated_at <= 0 then
    raise exception 'source_updated_at_required' using errcode = '22023';
  end if;
  if p_email_hash_version is null or p_email_hash_version <= 0 then
    raise exception 'email_hash_version_invalid' using errcode = '22023';
  end if;
  if p_email_lookup_hash is not null
    and p_email_lookup_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'email_lookup_hash_invalid' using errcode = '22023';
  end if;

  insert into private.clerk_user_identity_sync_state (owner_id)
  values (p_owner_id)
  on conflict (owner_id) do nothing;

  select * into strict sync_state
  from private.clerk_user_identity_sync_state
  where owner_id = p_owner_id
  for update;

  if sync_state.account_closed
    or p_source_updated_at < sync_state.source_updated_at
    or (
      p_source_updated_at = sync_state.source_updated_at
      and not coalesce(p_allow_same_source_version, false)
    ) then
    return false;
  end if;

  if p_email_lookup_hash is null then
    delete from public.collaboration_identities
    where owner_id = p_owner_id;
  else
    insert into public.collaboration_identities as identity (
      owner_id,
      email_lookup_hash,
      email_hash_version,
      discoverable_by_email,
      group_invite_policy,
      updated_at
    ) values (
      p_owner_id,
      p_email_lookup_hash,
      p_email_hash_version,
      coalesce(p_discoverable_by_email, false),
      coalesce(p_group_invite_policy, 'friends_only'),
      now()
    )
    on conflict (owner_id) do update set
      email_lookup_hash = excluded.email_lookup_hash,
      email_hash_version = excluded.email_hash_version,
      discoverable_by_email = coalesce(
        p_discoverable_by_email,
        identity.discoverable_by_email
      ),
      group_invite_policy = coalesce(
        p_group_invite_policy,
        identity.group_invite_policy
      ),
      updated_at = now();
  end if;

  update private.clerk_user_identity_sync_state
  set
    source_updated_at = p_source_updated_at,
    updated_at = now()
  where owner_id = p_owner_id;

  return true;
end;
$$;

revoke all on function private.sync_clerk_collaboration_identity(
  text, bigint, text, integer, boolean, public.group_invite_policy, boolean
) from public, anon, authenticated;
grant execute on function private.sync_clerk_collaboration_identity(
  text, bigint, text, integer, boolean, public.group_invite_policy, boolean
) to service_role;

create or replace function public.sync_clerk_collaboration_identity(
  p_owner_id text,
  p_source_updated_at bigint,
  p_email_lookup_hash text,
  p_email_hash_version integer default 1,
  p_discoverable_by_email boolean default null,
  p_group_invite_policy public.group_invite_policy default null,
  p_allow_same_source_version boolean default false
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.sync_clerk_collaboration_identity(
    p_owner_id,
    p_source_updated_at,
    p_email_lookup_hash,
    p_email_hash_version,
    p_discoverable_by_email,
    p_group_invite_policy,
    p_allow_same_source_version
  );
$$;

revoke all on function public.sync_clerk_collaboration_identity(
  text, bigint, text, integer, boolean, public.group_invite_policy, boolean
) from public, anon, authenticated;
grant execute on function public.sync_clerk_collaboration_identity(
  text, bigint, text, integer, boolean, public.group_invite_policy, boolean
) to service_role;

comment on function public.sync_clerk_collaboration_identity(
  text, bigint, text, integer, boolean, public.group_invite_policy, boolean
) is
  'Service-role-only source-version-aware Clerk collaboration identity synchronization.';

comment on function private.sync_clerk_collaboration_identity(
  text, bigint, text, integer, boolean, public.group_invite_policy, boolean
) is
  'Private atomic implementation for source-version-aware Clerk collaboration identity synchronization.';

create or replace function public.handle_clerk_user_deleted(
  p_owner_id text
)
returns table (
  groups_transferred integer,
  groups_deleted integer,
  memberships_removed integer,
  collaboration_identities_removed integer
)
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  transferred_count integer;
  deleted_count integer;
  membership_count integer;
  identity_count integer := 0;
begin
  if p_owner_id is null or btrim(p_owner_id) = '' then
    raise exception 'account_owner_required' using errcode = '22023';
  end if;

  insert into private.clerk_user_identity_sync_state (owner_id)
  values (p_owner_id)
  on conflict (owner_id) do nothing;

  perform 1
  from private.clerk_user_identity_sync_state
  where owner_id = p_owner_id
  for update;

  update private.clerk_user_identity_sync_state
  set
    account_closed = true,
    updated_at = now()
  where owner_id = p_owner_id;

  update public.research_group_invitations
  set
    status = 'revoked',
    token_digest = null,
    resolved_at = now(),
    updated_at = now()
  where status = 'pending'
    and p_owner_id in (inviter_id, recipient_id);

  select
    closure.groups_transferred,
    closure.groups_deleted,
    closure.memberships_removed
  into
    transferred_count,
    deleted_count,
    membership_count
  from public.handle_research_group_account_closure(p_owner_id) as closure;

  delete from public.collaboration_identities
  where owner_id = p_owner_id;
  get diagnostics identity_count = row_count;

  return query
  select
    coalesce(transferred_count, 0),
    coalesce(deleted_count, 0),
    coalesce(membership_count, 0),
    identity_count;
end;
$$;

revoke all on function public.handle_clerk_user_deleted(text)
  from public, anon, authenticated;
grant execute on function public.handle_clerk_user_deleted(text)
  to service_role;

comment on function public.handle_clerk_user_deleted(text) is
  'Service-role-only atomic account closure, identity cleanup, and permanent Clerk sync boundary.';
