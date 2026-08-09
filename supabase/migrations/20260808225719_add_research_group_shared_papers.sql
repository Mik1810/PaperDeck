create type public.research_group_paper_notification_preference as enum (
  'all',
  'important_only',
  'muted'
);

create type public.research_group_paper_activity_kind as enum (
  'papers_added',
  'paper_removed'
);

alter table public.research_group_members
  add column paper_notification_preference
    public.research_group_paper_notification_preference
    not null
    default 'all';

create table public.research_group_paper_items (
  group_id uuid not null
    references public.research_groups(id) on delete cascade,
  paper_id uuid not null
    references public.papers(id) on delete cascade,
  added_by text
    references public.profiles(owner_id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (group_id, paper_id)
);

create index research_group_paper_items_group_added_idx
  on public.research_group_paper_items (group_id, added_at desc, paper_id);
create index research_group_paper_items_paper_idx
  on public.research_group_paper_items (paper_id);
create index research_group_paper_items_contributor_idx
  on public.research_group_paper_items (added_by)
  where added_by is not null;

create table public.research_group_paper_activity (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null
    references public.research_groups(id) on delete cascade,
  kind public.research_group_paper_activity_kind not null,
  actor_id text
    references public.profiles(owner_id) on delete set null,
  representative_paper_id uuid
    references public.papers(id) on delete set null,
  event_count integer not null default 1,
  bucket_started_at timestamptz,
  first_occurred_at timestamptz not null default now(),
  last_occurred_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  constraint research_group_paper_activity_count_check
    check (event_count > 0),
  constraint research_group_paper_activity_time_check
    check (
      first_occurred_at <= last_occurred_at
      and last_occurred_at < expires_at
    ),
  constraint research_group_paper_activity_kind_check
    check (
      (kind = 'papers_added' and bucket_started_at is not null)
      or
      (kind = 'paper_removed' and bucket_started_at is null and event_count = 1)
    ),
  unique (group_id, actor_id, kind, bucket_started_at)
);

create index research_group_paper_activity_group_created_idx
  on public.research_group_paper_activity (
    group_id,
    last_occurred_at desc,
    id desc
  );
create index research_group_paper_activity_expiry_idx
  on public.research_group_paper_activity (expires_at, id);
create index research_group_paper_activity_actor_idx
  on public.research_group_paper_activity (actor_id)
  where actor_id is not null;

alter table public.research_group_paper_items enable row level security;
alter table public.research_group_paper_activity enable row level security;

create policy research_group_paper_items_member_read
  on public.research_group_paper_items
  for select
  to authenticated
  using (
    (select private.research_groups_reads_enabled())
    and (select private.research_group_is_active_member(group_id))
  );

create policy research_group_paper_activity_member_read
  on public.research_group_paper_activity
  for select
  to authenticated
  using (
    expires_at > now()
    and (select private.research_groups_reads_enabled())
    and (select private.research_group_is_active_member(group_id))
  );

revoke all on table public.research_group_paper_items
  from public, anon, authenticated;
revoke all on table public.research_group_paper_activity
  from public, anon, authenticated;
grant select on table public.research_group_paper_items to authenticated;
grant select on table public.research_group_paper_activity to authenticated;
grant select, insert, update, delete
  on table public.research_group_paper_items to service_role;
grant select, insert, update, delete
  on table public.research_group_paper_activity to service_role;

alter table public.notifications
  add column group_paper_activity_id uuid
    references public.research_group_paper_activity(id) on delete cascade;
create index notifications_group_paper_activity_idx
  on public.notifications (group_paper_activity_id)
  where group_paper_activity_id is not null;

alter type public.notification_type add value 'group_papers_added';
alter type public.notification_type add value 'group_paper_removed';

comment on table public.research_group_paper_items is
  'The current chronological shared-paper list for each private research group. It is isolated from every personal library and ranking signal.';
comment on table public.research_group_paper_activity is
  'Minimal 90-day paper activity used as the authoritative source for aggregated group notifications; no rendered text or personal library state is stored.';
