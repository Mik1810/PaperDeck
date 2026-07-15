create type public.group_invite_policy as enum (
  'nobody',
  'friends_only',
  'anyone'
);

create table public.collaboration_identities (
  owner_id text primary key references public.profiles(owner_id) on delete cascade,
  public_id uuid not null default gen_random_uuid() unique,
  email_lookup_hash text not null unique check (email_lookup_hash ~ '^[0-9a-f]{64}$'),
  email_hash_version integer not null default 1 check (email_hash_version > 0),
  discoverable_by_email boolean not null default true,
  group_invite_policy public.group_invite_policy not null default 'friends_only',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.collaboration_search_limits (
  requester_id text primary key references public.profiles(owner_id) on delete cascade,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0)
);

alter table public.collaboration_identities enable row level security;
alter table public.collaboration_search_limits enable row level security;

create policy collaboration_identities_select_own
  on public.collaboration_identities for select to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));

create policy collaboration_identities_insert_own
  on public.collaboration_identities for insert to authenticated
  with check (owner_id = (auth.jwt() ->> 'sub'));

create policy collaboration_identities_update_own
  on public.collaboration_identities for update to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'))
  with check (owner_id = (auth.jwt() ->> 'sub'));

create policy collaboration_identities_delete_own
  on public.collaboration_identities for delete to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));

create or replace function public.find_collaboration_profile(p_email_lookup_hash text)
returns table (
  public_id uuid,
  display_name text,
  image_url text
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

  if p_email_lookup_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  insert into public.collaboration_search_limits as limits (
    requester_id,
    window_started_at,
    attempt_count
  ) values (
    requester,
    now(),
    1
  )
  on conflict (requester_id) do update set
    window_started_at = case
      when limits.window_started_at <= now() - interval '1 minute' then now()
      else limits.window_started_at
    end,
    attempt_count = case
      when limits.window_started_at <= now() - interval '1 minute' then 1
      else limits.attempt_count + 1
    end
  returning attempt_count into current_attempt_count;

  if current_attempt_count > 10 then
    raise exception 'rate_limit_exceeded' using errcode = 'P0001';
  end if;

  return query
  select identity.public_id, profile.display_name, profile.image_url
  from public.collaboration_identities identity
  join public.profiles profile on profile.owner_id = identity.owner_id
  where identity.email_lookup_hash = p_email_lookup_hash
    and identity.discoverable_by_email
    and identity.owner_id <> requester
    and profile.display_name is not null
    and position('@' in profile.display_name) = 0
    and char_length(btrim(profile.display_name)) between 2 and 50
  limit 1;
end;
$$;

revoke all on function public.find_collaboration_profile(text) from public;
revoke all on function public.find_collaboration_profile(text) from anon;
grant execute on function public.find_collaboration_profile(text) to authenticated;
