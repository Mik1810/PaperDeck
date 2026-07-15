create type public.friend_request_status as enum (
  'pending',
  'accepted',
  'declined',
  'cancelled'
);

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id text not null references public.profiles(owner_id) on delete cascade,
  recipient_id text not null references public.profiles(owner_id) on delete cascade,
  status public.friend_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  updated_at timestamptz not null default now(),
  check (requester_id <> recipient_id)
);

create unique index friend_requests_one_pending_pair_idx
  on public.friend_requests (
    least(requester_id, recipient_id),
    greatest(requester_id, recipient_id)
  )
  where status = 'pending';
create index friend_requests_requester_created_idx
  on public.friend_requests (requester_id, created_at desc);
create index friend_requests_recipient_status_idx
  on public.friend_requests (recipient_id, status, created_at desc);

create table public.friendships (
  user_low_id text not null references public.profiles(owner_id) on delete cascade,
  user_high_id text not null references public.profiles(owner_id) on delete cascade,
  accepted_request_id uuid references public.friend_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_low_id, user_high_id),
  check (user_low_id < user_high_id)
);
create index friendships_high_user_idx
  on public.friendships (user_high_id, created_at desc);

create table public.user_blocks (
  blocker_id text not null references public.profiles(owner_id) on delete cascade,
  blocked_id text not null references public.profiles(owner_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index user_blocks_blocked_idx on public.user_blocks (blocked_id);

alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.user_blocks enable row level security;

create policy friend_requests_participant_read
  on public.friend_requests for select to authenticated
  using ((auth.jwt() ->> 'sub') in (requester_id, recipient_id));

create policy friendships_participant_read
  on public.friendships for select to authenticated
  using ((auth.jwt() ->> 'sub') in (user_low_id, user_high_id));

create policy user_blocks_blocker_read
  on public.user_blocks for select to authenticated
  using (blocker_id = (auth.jwt() ->> 'sub'));

create or replace function public.send_friend_request(p_target_public_id uuid)
returns table (relationship_status text, request_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor text := auth.jwt() ->> 'sub';
  target text;
  existing_id uuid;
  existing_requester text;
  low_id text;
  high_id text;
begin
  select owner_id into target
  from public.collaboration_identities
  where public_id = p_target_public_id;

  if actor is null or target is null or actor = target then
    raise exception 'profile_unavailable' using errcode = 'P0001';
  end if;

  low_id := least(actor, target);
  high_id := greatest(actor, target);
  perform pg_advisory_xact_lock(hashtextextended(low_id || ':' || high_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('friend-request-rate:' || actor, 0));

  if exists (
    select 1 from public.user_blocks
    where (blocker_id = actor and blocked_id = target)
       or (blocker_id = target and blocked_id = actor)
  ) then
    raise exception 'profile_unavailable' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.friendships
    where user_low_id = low_id and user_high_id = high_id
  ) then
    return query select 'friends'::text, null::uuid;
    return;
  end if;

  select id, requester_id into existing_id, existing_requester
  from public.friend_requests
  where least(requester_id, recipient_id) = low_id
    and greatest(requester_id, recipient_id) = high_id
    and status = 'pending'
  limit 1;

  if existing_id is not null then
    if existing_requester = actor then
      return query select 'outgoing_pending'::text, existing_id;
      return;
    end if;

    update public.friend_requests
    set status = 'accepted', responded_at = now(), updated_at = now()
    where id = existing_id;
    insert into public.friendships (
      user_low_id, user_high_id, accepted_request_id
    ) values (low_id, high_id, existing_id)
    on conflict (user_low_id, user_high_id) do nothing;
    return query select 'friends'::text, existing_id;
    return;
  end if;

  if exists (
    select 1 from public.friend_requests
    where requester_id = actor
      and recipient_id = target
      and status = 'declined'
      and responded_at > now() - interval '30 days'
  ) then
    raise exception 'friend_request_cooldown' using errcode = 'P0001';
  end if;

  if (
    select count(*) from public.friend_requests
    where requester_id = actor
      and created_at > now() - interval '24 hours'
  ) >= 10 then
    raise exception 'friend_request_rate_limited' using errcode = 'P0001';
  end if;

  insert into public.friend_requests (requester_id, recipient_id)
  values (actor, target)
  returning id into existing_id;
  return query select 'outgoing_pending'::text, existing_id;
end;
$$;

create or replace function public.respond_friend_request(
  p_request_id uuid,
  p_accept boolean
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor text := auth.jwt() ->> 'sub';
  request_row public.friend_requests%rowtype;
  low_id text;
  high_id text;
begin
  select * into request_row from public.friend_requests where id = p_request_id;
  if actor is null or request_row.id is null or request_row.recipient_id <> actor then
    raise exception 'request_unavailable' using errcode = 'P0001';
  end if;

  low_id := least(request_row.requester_id, request_row.recipient_id);
  high_id := greatest(request_row.requester_id, request_row.recipient_id);
  perform pg_advisory_xact_lock(hashtextextended(low_id || ':' || high_id, 0));
  select * into request_row from public.friend_requests where id = p_request_id for update;

  if request_row.status = 'accepted' then return 'friends'; end if;
  if request_row.status = 'declined' then return 'declined'; end if;
  if request_row.status <> 'pending' then return 'cancelled'; end if;

  if exists (
    select 1 from public.user_blocks
    where (blocker_id = request_row.requester_id and blocked_id = request_row.recipient_id)
       or (blocker_id = request_row.recipient_id and blocked_id = request_row.requester_id)
  ) then
    update public.friend_requests
    set status = 'cancelled', responded_at = now(), updated_at = now()
    where id = p_request_id;
    raise exception 'request_unavailable' using errcode = 'P0001';
  end if;

  if p_accept then
    update public.friend_requests
    set status = 'accepted', responded_at = now(), updated_at = now()
    where id = p_request_id;
    insert into public.friendships (
      user_low_id, user_high_id, accepted_request_id
    ) values (low_id, high_id, p_request_id)
    on conflict (user_low_id, user_high_id) do nothing;
    return 'friends';
  end if;

  update public.friend_requests
  set status = 'declined', responded_at = now(), updated_at = now()
  where id = p_request_id;
  return 'declined';
end;
$$;

create or replace function public.cancel_friend_request(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor text := auth.jwt() ->> 'sub';
  request_row public.friend_requests%rowtype;
begin
  select * into request_row
  from public.friend_requests where id = p_request_id for update;
  if actor is null or request_row.id is null or request_row.requester_id <> actor then
    raise exception 'request_unavailable' using errcode = 'P0001';
  end if;
  if request_row.status = 'pending' then
    update public.friend_requests
    set status = 'cancelled', responded_at = now(), updated_at = now()
    where id = p_request_id;
  end if;
  return request_row.status::text;
end;
$$;

create or replace function public.unfriend_profile(p_target_public_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor text := auth.jwt() ->> 'sub';
  target text;
begin
  select owner_id into target from public.collaboration_identities
  where public_id = p_target_public_id;
  if actor is null or target is null or actor = target then
    raise exception 'profile_unavailable' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(least(actor, target) || ':' || greatest(actor, target), 0)
  );
  delete from public.friendships
  where user_low_id = least(actor, target)
    and user_high_id = greatest(actor, target);
  return true;
end;
$$;

create or replace function public.block_profile(p_target_public_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor text := auth.jwt() ->> 'sub';
  target text;
begin
  select owner_id into target from public.collaboration_identities
  where public_id = p_target_public_id;
  if actor is null or target is null or actor = target then
    raise exception 'profile_unavailable' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(least(actor, target) || ':' || greatest(actor, target), 0)
  );
  insert into public.user_blocks (blocker_id, blocked_id)
  values (actor, target) on conflict do nothing;
  delete from public.friendships
  where user_low_id = least(actor, target)
    and user_high_id = greatest(actor, target);
  update public.friend_requests
  set status = 'cancelled', responded_at = now(), updated_at = now()
  where status = 'pending'
    and least(requester_id, recipient_id) = least(actor, target)
    and greatest(requester_id, recipient_id) = greatest(actor, target);
  return true;
end;
$$;

create or replace function public.unblock_profile(p_target_public_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor text := auth.jwt() ->> 'sub';
  target text;
begin
  select owner_id into target from public.collaboration_identities
  where public_id = p_target_public_id;
  if actor is null or target is null or actor = target then
    raise exception 'profile_unavailable' using errcode = 'P0001';
  end if;
  delete from public.user_blocks where blocker_id = actor and blocked_id = target;
  return true;
end;
$$;

drop function public.find_collaboration_profile(text);
create function public.find_collaboration_profile(p_email_lookup_hash text)
returns table (
  public_id uuid,
  display_name text,
  image_url text,
  relationship_status text,
  request_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester text := auth.jwt() ->> 'sub';
  current_attempt_count integer;
begin
  if requester is null or requester = '' then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_email_lookup_hash !~ '^[0-9a-f]{64}$' then return; end if;

  insert into public.collaboration_search_limits as limits (
    requester_id, window_started_at, attempt_count
  ) values (requester, now(), 1)
  on conflict (requester_id) do update set
    window_started_at = case
      when limits.window_started_at <= now() - interval '1 minute' then now()
      else limits.window_started_at end,
    attempt_count = case
      when limits.window_started_at <= now() - interval '1 minute' then 1
      else limits.attempt_count + 1 end
  returning attempt_count into current_attempt_count;
  if current_attempt_count > 10 then
    raise exception 'rate_limit_exceeded' using errcode = 'P0001';
  end if;

  return query
  select identity.public_id, profile.display_name, profile.image_url,
    case
      when friendship.user_low_id is not null then 'friends'
      when pending.requester_id = requester then 'outgoing_pending'
      when pending.recipient_id = requester then 'incoming_pending'
      else 'none'
    end,
    pending.id
  from public.collaboration_identities identity
  join public.profiles profile on profile.owner_id = identity.owner_id
  left join public.friendships friendship
    on friendship.user_low_id = least(requester, identity.owner_id)
   and friendship.user_high_id = greatest(requester, identity.owner_id)
  left join lateral (
    select request.id, request.requester_id, request.recipient_id
    from public.friend_requests request
    where request.status = 'pending'
      and least(request.requester_id, request.recipient_id) = least(requester, identity.owner_id)
      and greatest(request.requester_id, request.recipient_id) = greatest(requester, identity.owner_id)
    limit 1
  ) pending on true
  where identity.email_lookup_hash = p_email_lookup_hash
    and identity.discoverable_by_email
    and identity.owner_id <> requester
    and profile.display_name is not null
    and position('@' in profile.display_name) = 0
    and char_length(btrim(profile.display_name)) between 2 and 50
    and not exists (
      select 1 from public.user_blocks block
      where (block.blocker_id = requester and block.blocked_id = identity.owner_id)
         or (block.blocker_id = identity.owner_id and block.blocked_id = requester)
    )
  limit 1;
end;
$$;

create or replace function public.list_collaboration_connections()
returns table (
  public_id uuid,
  display_name text,
  image_url text,
  relationship_status text,
  request_id uuid,
  occurred_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with actor as (select auth.jwt() ->> 'sub' as id),
  connections as (
  select identity.public_id, profile.display_name, profile.image_url,
    case when request.requester_id = actor.id
      then 'outgoing_pending' else 'incoming_pending' end,
    request.id, request.created_at as occurred_at
  from actor
  join public.friend_requests request
    on actor.id in (request.requester_id, request.recipient_id)
   and request.status = 'pending'
  join public.collaboration_identities identity
    on identity.owner_id = case when request.requester_id = actor.id
      then request.recipient_id else request.requester_id end
  join public.profiles profile on profile.owner_id = identity.owner_id
  union all
  select identity.public_id, profile.display_name, profile.image_url,
    'friends', null::uuid, friendship.created_at
  from actor
  join public.friendships friendship
    on actor.id in (friendship.user_low_id, friendship.user_high_id)
  join public.collaboration_identities identity
    on identity.owner_id = case when friendship.user_low_id = actor.id
      then friendship.user_high_id else friendship.user_low_id end
  join public.profiles profile on profile.owner_id = identity.owner_id
  union all
  select identity.public_id, profile.display_name, profile.image_url,
    'blocked', null::uuid, block.created_at
  from actor
  join public.user_blocks block on block.blocker_id = actor.id
  join public.collaboration_identities identity on identity.owner_id = block.blocked_id
  join public.profiles profile on profile.owner_id = identity.owner_id
  )
  select * from connections order by occurred_at desc;
$$;

revoke all on function public.send_friend_request(uuid) from public, anon;
revoke all on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke all on function public.cancel_friend_request(uuid) from public, anon;
revoke all on function public.unfriend_profile(uuid) from public, anon;
revoke all on function public.block_profile(uuid) from public, anon;
revoke all on function public.unblock_profile(uuid) from public, anon;
revoke all on function public.find_collaboration_profile(text) from public, anon;
revoke all on function public.list_collaboration_connections() from public, anon;

grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
grant execute on function public.unfriend_profile(uuid) to authenticated;
grant execute on function public.block_profile(uuid) to authenticated;
grant execute on function public.unblock_profile(uuid) to authenticated;
grant execute on function public.find_collaboration_profile(text) to authenticated;
grant execute on function public.list_collaboration_connections() to authenticated;
