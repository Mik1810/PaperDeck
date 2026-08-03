create type public.research_group_invitation_status as enum (
  'pending',
  'accepted',
  'declined',
  'cancelled',
  'revoked',
  'expired'
);

create table public.research_group_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.research_groups(id)
    on delete cascade,
  inviter_id text not null references public.profiles(owner_id)
    on delete cascade,
  recipient_id text not null references public.profiles(owner_id)
    on delete cascade,
  token_digest text,
  status public.research_group_invitation_status not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  check (inviter_id <> recipient_id),
  check (expires_at > created_at),
  check (
    (status = 'pending' and token_digest is not null and resolved_at is null)
    or
    (status <> 'pending' and token_digest is null and resolved_at is not null)
  ),
  check (token_digest is null or token_digest ~ '^[0-9a-f]{64}$')
);

create unique index research_group_invitations_one_pending_recipient_idx
  on public.research_group_invitations (group_id, recipient_id)
  where status = 'pending';
create index research_group_invitations_recipient_status_idx
  on public.research_group_invitations (
    recipient_id,
    status,
    created_at desc
  );
create index research_group_invitations_group_status_idx
  on public.research_group_invitations (
    group_id,
    status,
    created_at desc
  );
create index research_group_invitations_inviter_idx
  on public.research_group_invitations (inviter_id);

alter table public.research_group_invitations enable row level security;

create policy research_group_invitations_recipient_read
  on public.research_group_invitations
  for select
  to authenticated
  using (
    recipient_id = (select auth.jwt() ->> 'sub')
    and (select private.research_groups_reads_enabled())
  );

revoke all on table public.research_group_invitations
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.research_group_invitations to service_role;

create or replace function private.research_group_invite_policy_allows(
  p_inviter_id text,
  p_recipient_id text
)
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.collaboration_identities as identity
    where identity.owner_id = p_recipient_id
      and identity.discoverable_by_email
      and (
        identity.group_invite_policy = 'anyone'
        or (
          identity.group_invite_policy = 'friends_only'
          and exists (
            select 1
            from public.friendships as friendship
            where friendship.user_low_id = least(
                p_inviter_id,
                p_recipient_id
              )
              and friendship.user_high_id = greatest(
                p_inviter_id,
                p_recipient_id
              )
          )
        )
      )
      and not exists (
        select 1
        from public.user_blocks as blocked
        where (
          blocked.blocker_id = p_inviter_id
          and blocked.blocked_id = p_recipient_id
        ) or (
          blocked.blocker_id = p_recipient_id
          and blocked.blocked_id = p_inviter_id
        )
      )
  );
$$;

create or replace function private.research_group_actor_role(
  p_actor_id text,
  p_group_id uuid
)
returns public.research_group_role
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select membership.role
  from public.research_group_members as membership
  join public.research_groups as research_group
    on research_group.id = membership.group_id
  where membership.group_id = p_group_id
    and membership.member_id = p_actor_id
    and membership.revoked_at is null
    and research_group.state = 'active';
$$;

create or replace function public.create_research_group_invitation(
  p_actor_id text,
  p_group_id uuid,
  p_recipient_public_id uuid,
  p_token_digest text
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  actor_role public.research_group_role;
  target_owner_id text;
  invitation_id uuid;
  reads_enabled boolean;
  writes_enabled boolean;
begin
  if p_actor_id is null or btrim(p_actor_id) = ''
    or p_token_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'research_group_unavailable' using errcode = 'P0001';
  end if;

  select settings.reads_enabled, settings.writes_enabled
  into reads_enabled, writes_enabled
  from private.research_group_runtime_settings as settings
  where settings.singleton
  for share;

  perform 1
  from public.research_groups
  where id = p_group_id and state = 'active'
  for update;

  actor_role := private.research_group_actor_role(p_actor_id, p_group_id);
  if not coalesce(reads_enabled and writes_enabled, false)
    or actor_role is null
    or actor_role not in ('owner', 'admin') then
    raise exception 'research_group_unavailable' using errcode = 'P0001';
  end if;

  select identity.owner_id
  into target_owner_id
  from public.collaboration_identities as identity
  where identity.public_id = p_recipient_public_id
    and identity.discoverable_by_email;

  if target_owner_id is null or target_owner_id = p_actor_id
    or not private.research_group_invite_policy_allows(
      p_actor_id,
      target_owner_id
    ) then
    raise exception 'research_group_unavailable' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'research-group-invite:' || p_group_id::text || ':' || target_owner_id,
      0
    )
  );

  update public.research_group_invitations as invitation
  set
    status = 'expired',
    token_digest = null,
    resolved_at = now(),
    updated_at = now()
  where invitation.group_id = p_group_id
    and invitation.recipient_id = target_owner_id
    and invitation.status = 'pending'
    and invitation.expires_at <= now();

  if exists (
    select 1
    from public.research_group_members as membership
    where membership.group_id = p_group_id
      and membership.member_id = target_owner_id
      and membership.revoked_at is null
  ) or exists (
    select 1
    from public.research_group_invitations as invitation
    where invitation.group_id = p_group_id
      and invitation.recipient_id = target_owner_id
      and invitation.status = 'pending'
  ) then
    raise exception 'research_group_unavailable' using errcode = 'P0001';
  end if;

  insert into public.research_group_invitations (
    group_id,
    inviter_id,
    recipient_id,
    token_digest
  ) values (
    p_group_id,
    p_actor_id,
    target_owner_id,
    p_token_digest
  )
  returning id into invitation_id;

  return invitation_id;
end;
$$;

create or replace function public.respond_research_group_invitation(
  p_actor_id text,
  p_invitation_id uuid,
  p_token_digest text,
  p_accept boolean
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  invitation public.research_group_invitations%rowtype;
  reads_enabled boolean;
  writes_enabled boolean;
begin
  if p_actor_id is null or btrim(p_actor_id) = ''
    or p_token_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'invitation_unavailable' using errcode = 'P0001';
  end if;

  select *
  into invitation
  from public.research_group_invitations
  where id = p_invitation_id
  for update;

  if invitation.id is null or invitation.recipient_id <> p_actor_id then
    raise exception 'invitation_unavailable' using errcode = 'P0001';
  end if;
  if invitation.status = 'accepted' and p_accept then
    return 'accepted';
  end if;
  if invitation.status = 'declined' and not p_accept then
    return 'declined';
  end if;
  if invitation.status <> 'pending'
    or invitation.token_digest <> p_token_digest then
    raise exception 'invitation_unavailable' using errcode = 'P0001';
  end if;

  if invitation.expires_at <= now() then
    update public.research_group_invitations
    set
      status = 'expired',
      token_digest = null,
      resolved_at = now(),
      updated_at = now()
    where id = invitation.id;
    return 'unavailable';
  end if;

  select settings.reads_enabled, settings.writes_enabled
  into reads_enabled, writes_enabled
  from private.research_group_runtime_settings as settings
  where settings.singleton
  for share;

  perform 1
  from public.research_groups
  where id = invitation.group_id and state = 'active'
  for update;

  if not found
    or not coalesce(reads_enabled and writes_enabled, false)
    or not private.research_group_invite_policy_allows(
      invitation.inviter_id,
      invitation.recipient_id
    ) then
    update public.research_group_invitations
    set
      status = 'revoked',
      token_digest = null,
      resolved_at = now(),
      updated_at = now()
    where id = invitation.id;
    return 'unavailable';
  end if;

  if not p_accept then
    update public.research_group_invitations
    set
      status = 'declined',
      token_digest = null,
      resolved_at = now(),
      updated_at = now()
    where id = invitation.id;
    return 'declined';
  end if;

  insert into public.research_group_members (
    group_id,
    member_id,
    role,
    joined_at,
    updated_at,
    revoked_at
  ) values (
    invitation.group_id,
    invitation.recipient_id,
    'member',
    now(),
    now(),
    null
  )
  on conflict (group_id, member_id) do update set
    role = 'member',
    joined_at = now(),
    updated_at = now(),
    revoked_at = null;

  update public.research_group_invitations
  set
    status = 'accepted',
    token_digest = null,
    resolved_at = now(),
    updated_at = now()
  where id = invitation.id;

  return 'accepted';
end;
$$;

create or replace function public.cancel_research_group_invitation(
  p_actor_id text,
  p_invitation_id uuid
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  invitation public.research_group_invitations%rowtype;
  actor_role public.research_group_role;
begin
  perform 1
  from private.research_group_runtime_settings
  where singleton and reads_enabled and writes_enabled
  for share;
  if not found then
    raise exception 'research_group_unavailable' using errcode = 'P0001';
  end if;

  select *
  into invitation
  from public.research_group_invitations
  where id = p_invitation_id
  for update;

  actor_role := private.research_group_actor_role(
    p_actor_id,
    invitation.group_id
  );
  if invitation.id is null
    or invitation.inviter_id <> p_actor_id
    or actor_role is null
    or actor_role not in ('owner', 'admin') then
    raise exception 'invitation_unavailable' using errcode = 'P0001';
  end if;

  if invitation.status = 'pending' then
    update public.research_group_invitations
    set
      status = 'cancelled',
      token_digest = null,
      resolved_at = now(),
      updated_at = now()
    where id = invitation.id;
  elsif invitation.status <> 'cancelled' then
    raise exception 'invitation_unavailable' using errcode = 'P0001';
  end if;
  return 'cancelled';
end;
$$;

create or replace function public.revoke_research_group_invitation(
  p_actor_id text,
  p_invitation_id uuid
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  invitation public.research_group_invitations%rowtype;
  actor_role public.research_group_role;
begin
  perform 1
  from private.research_group_runtime_settings
  where singleton and reads_enabled and writes_enabled
  for share;
  if not found then
    raise exception 'research_group_unavailable' using errcode = 'P0001';
  end if;

  select *
  into invitation
  from public.research_group_invitations
  where id = p_invitation_id
  for update;

  actor_role := private.research_group_actor_role(
    p_actor_id,
    invitation.group_id
  );
  if invitation.id is null
    or actor_role is null
    or actor_role not in ('owner', 'admin') then
    raise exception 'invitation_unavailable' using errcode = 'P0001';
  end if;

  if invitation.status = 'pending' then
    update public.research_group_invitations
    set
      status = 'revoked',
      token_digest = null,
      resolved_at = now(),
      updated_at = now()
    where id = invitation.id;
  elsif invitation.status <> 'revoked' then
    raise exception 'invitation_unavailable' using errcode = 'P0001';
  end if;
  return 'revoked';
end;
$$;

create or replace function public.set_research_group_member_role(
  p_actor_id text,
  p_group_id uuid,
  p_member_public_id uuid,
  p_role public.research_group_role
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  target_owner_id text;
begin
  perform 1
  from private.research_group_runtime_settings
  where singleton and reads_enabled and writes_enabled
  for share;
  if not found then
    raise exception 'research_group_unavailable' using errcode = 'P0001';
  end if;

  perform 1
  from public.research_groups
  where id = p_group_id and state = 'active'
  for update;

  if private.research_group_actor_role(
      p_actor_id,
      p_group_id
    ) is distinct from 'owner'
    or p_role not in ('admin', 'member') then
    raise exception 'research_group_unavailable' using errcode = 'P0001';
  end if;

  select identity.owner_id
  into target_owner_id
  from public.collaboration_identities as identity
  join public.research_group_members as membership
    on membership.member_id = identity.owner_id
  where identity.public_id = p_member_public_id
    and membership.group_id = p_group_id
    and membership.role <> 'owner'
    and membership.revoked_at is null
  for update of membership;

  if target_owner_id is null then
    raise exception 'research_group_unavailable' using errcode = 'P0001';
  end if;

  update public.research_group_members as membership
  set role = p_role, updated_at = now()
  where membership.group_id = p_group_id
    and membership.member_id = target_owner_id;
  return true;
end;
$$;

create or replace function public.remove_research_group_member(
  p_actor_id text,
  p_group_id uuid,
  p_member_public_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  actor_role public.research_group_role;
  target_id text;
  target_role public.research_group_role;
begin
  perform 1
  from private.research_group_runtime_settings
  where singleton and reads_enabled and writes_enabled
  for share;
  if not found then
    raise exception 'research_group_unavailable' using errcode = 'P0001';
  end if;

  perform 1
  from public.research_groups
  where id = p_group_id and state = 'active'
  for update;

  actor_role := private.research_group_actor_role(p_actor_id, p_group_id);
  select identity.owner_id, membership.role
  into target_id, target_role
  from public.collaboration_identities as identity
  join public.research_group_members as membership
    on membership.member_id = identity.owner_id
  where identity.public_id = p_member_public_id
    and membership.group_id = p_group_id
    and membership.revoked_at is null
  for update of membership;

  if target_id is null or target_id = p_actor_id or target_role = 'owner'
    or actor_role is null
    or actor_role not in ('owner', 'admin')
    or (actor_role = 'admin' and target_role <> 'member') then
    raise exception 'research_group_unavailable' using errcode = 'P0001';
  end if;

  update public.research_group_members
  set revoked_at = now(), updated_at = now()
  where group_id = p_group_id and member_id = target_id;
  update public.research_groups
  set
    selected_successor_id = null,
    revision = revision + 1,
    updated_at = now()
  where id = p_group_id and selected_successor_id = target_id;
  return true;
end;
$$;

create or replace function public.leave_research_group(
  p_actor_id text,
  p_group_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  actor_role public.research_group_role;
begin
  perform 1
  from private.research_group_runtime_settings
  where singleton and reads_enabled and writes_enabled
  for share;
  if not found then
    raise exception 'research_group_unavailable' using errcode = 'P0001';
  end if;

  perform 1
  from public.research_groups
  where id = p_group_id and state = 'active'
  for update;
  actor_role := private.research_group_actor_role(p_actor_id, p_group_id);
  if actor_role is null or actor_role not in ('admin', 'member') then
    raise exception 'research_group_unavailable' using errcode = 'P0001';
  end if;

  update public.research_group_members
  set revoked_at = now(), updated_at = now()
  where group_id = p_group_id and member_id = p_actor_id;
  update public.research_groups
  set
    selected_successor_id = null,
    revision = revision + 1,
    updated_at = now()
  where id = p_group_id and selected_successor_id = p_actor_id;
  return true;
end;
$$;

create or replace function private.revoke_research_group_invites_on_block()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  update public.research_group_invitations
  set
    status = 'revoked',
    token_digest = null,
    resolved_at = now(),
    updated_at = now()
  where status = 'pending'
    and (
      (inviter_id = new.blocker_id and recipient_id = new.blocked_id)
      or
      (inviter_id = new.blocked_id and recipient_id = new.blocker_id)
    );
  return new;
end;
$$;

create trigger research_group_invites_revoke_on_block
after insert on public.user_blocks
for each row execute function private.revoke_research_group_invites_on_block();

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
set search_path = pg_catalog, public
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

revoke all on function private.research_group_invite_policy_allows(text, text)
  from public, anon, authenticated;
revoke all on function private.research_group_actor_role(text, uuid)
  from public, anon, authenticated;
revoke all on function private.revoke_research_group_invites_on_block()
  from public, anon, authenticated;
grant execute on function private.research_group_invite_policy_allows(
  text, text
) to service_role;
grant execute on function private.research_group_actor_role(text, uuid)
  to service_role;

revoke all on function public.create_research_group_invitation(
  text, uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.respond_research_group_invitation(
  text, uuid, text, boolean
) from public, anon, authenticated;
revoke all on function public.cancel_research_group_invitation(text, uuid)
  from public, anon, authenticated;
revoke all on function public.revoke_research_group_invitation(text, uuid)
  from public, anon, authenticated;
revoke all on function public.set_research_group_member_role(
  text, uuid, uuid, public.research_group_role
) from public, anon, authenticated;
revoke all on function public.remove_research_group_member(
  text, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.leave_research_group(text, uuid)
  from public, anon, authenticated;

grant execute on function public.create_research_group_invitation(
  text, uuid, uuid, text
) to service_role;
grant execute on function public.respond_research_group_invitation(
  text, uuid, text, boolean
) to service_role;
grant execute on function public.cancel_research_group_invitation(text, uuid)
  to service_role;
grant execute on function public.revoke_research_group_invitation(text, uuid)
  to service_role;
grant execute on function public.set_research_group_member_role(
  text, uuid, uuid, public.research_group_role
) to service_role;
grant execute on function public.remove_research_group_member(
  text, uuid, uuid
) to service_role;
grant execute on function public.leave_research_group(text, uuid)
  to service_role;

comment on table public.research_group_invitations is
  'Registered-recipient, seven-day, single-use research-group invitations. Raw tokens are never stored.';
