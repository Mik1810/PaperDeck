create extension if not exists pgcrypto;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema auth;
create schema private;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb;
$$;

create type public.research_group_role as enum ('owner', 'admin', 'member');
create type public.research_group_state as enum ('active', 'archived');
create type public.notification_type as enum (
  'friend_request_received',
  'friendship_accepted',
  'group_invitation_received',
  'group_invitation_accepted',
  'group_member_joined',
  'group_membership_ended',
  'group_role_changed',
  'group_ownership_transferred'
);

create table public.profiles (
  owner_id text primary key,
  display_name text,
  image_url text
);

create table public.papers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source text not null default 'manual',
  url text not null
);

create table public.research_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  state public.research_group_state not null default 'active'
);

create table public.research_group_members (
  group_id uuid not null references public.research_groups(id) on delete cascade,
  member_id text not null references public.profiles(owner_id) on delete cascade,
  role public.research_group_role not null,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (group_id, member_id)
);

create table private.research_group_runtime_settings (
  singleton boolean primary key default true check (singleton),
  reads_enabled boolean not null default false,
  writes_enabled boolean not null default false
);

insert into private.research_group_runtime_settings (
  singleton,
  reads_enabled,
  writes_enabled
) values (true, false, false);

create or replace function private.research_groups_reads_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
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
set search_path = ''
as $$
  select exists (
    select 1
    from public.research_group_members as membership
    join public.research_groups as research_group
      on research_group.id = membership.group_id
    where membership.group_id = p_group_id
      and membership.member_id = ((select auth.jwt()) ->> 'sub')
      and membership.revoked_at is null
      and research_group.state = 'active'
  );
$$;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id text not null references public.profiles(owner_id) on delete cascade,
  actor_id text references public.profiles(owner_id) on delete set null,
  type public.notification_type not null,
  dedupe_key text not null,
  friend_request_id uuid,
  group_invitation_id uuid,
  group_id uuid references public.research_groups(id) on delete cascade,
  read_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  constraint notifications_recipient_dedupe_key
    unique (recipient_id, dedupe_key),
  constraint notifications_source_check check (true)
);

create table public.favorites (
  owner_id text not null,
  paper_id uuid not null
);
create table public.playlist_items (
  owner_id text not null,
  paper_id uuid not null
);
create table public.user_paper_interactions (
  owner_id text not null,
  paper_id uuid not null
);
create table public.recommendations (
  owner_id text not null,
  paper_id uuid not null
);

grant usage on schema auth, private to authenticated;
grant execute on function auth.jwt() to authenticated;
grant execute on function private.research_groups_reads_enabled()
  to authenticated;
grant execute on function private.research_group_is_active_member(uuid)
  to authenticated;
