create table public.user_paper_feed_exclusions (
  owner_id text not null
    references public.profiles(owner_id) on delete cascade,
  paper_id uuid not null
    references public.papers(id) on delete cascade,
  cause public.interaction_type not null,
  excluded_at timestamptz not null default now(),
  primary key (owner_id, paper_id),
  constraint user_paper_feed_exclusions_cause_check
    check (
      cause in (
        'open_detail',
        'dismiss',
        'not_interested',
        'read',
        'already_read'
      )
    )
);

create index user_paper_feed_exclusions_paper_idx
  on public.user_paper_feed_exclusions (paper_id);

alter table public.user_paper_feed_exclusions enable row level security;

create policy user_paper_feed_exclusions_own
  on public.user_paper_feed_exclusions
  for all
  to authenticated
  using (owner_id = ((select auth.jwt()) ->> 'sub'))
  with check (owner_id = ((select auth.jwt()) ->> 'sub'));

revoke all on table public.user_paper_feed_exclusions
  from public, anon, authenticated;
grant select, insert, update on table public.user_paper_feed_exclusions
  to authenticated;

insert into public.user_paper_feed_exclusions (
  owner_id,
  paper_id,
  cause,
  excluded_at
)
select distinct on (interaction.owner_id, interaction.paper_id)
  interaction.owner_id,
  interaction.paper_id,
  interaction.action,
  interaction.created_at
from public.user_paper_interactions as interaction
where interaction.action in (
  'open_detail',
  'dismiss',
  'not_interested',
  'read',
  'already_read'
)
order by
  interaction.owner_id,
  interaction.paper_id,
  interaction.created_at desc,
  interaction.id desc;

create or replace function private.record_user_paper_feed_exclusion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.action not in (
    'open_detail',
    'dismiss',
    'not_interested',
    'read',
    'already_read'
  ) then
    return new;
  end if;

  insert into public.user_paper_feed_exclusions (
    owner_id,
    paper_id,
    cause,
    excluded_at
  ) values (
    new.owner_id,
    new.paper_id,
    new.action,
    new.created_at
  )
  on conflict (owner_id, paper_id) do update
  set
    cause = case
      when excluded.excluded_at >= public.user_paper_feed_exclusions.excluded_at
        then excluded.cause
      else public.user_paper_feed_exclusions.cause
    end,
    excluded_at = greatest(
      excluded.excluded_at,
      public.user_paper_feed_exclusions.excluded_at
    );

  return new;
end;
$$;

drop trigger if exists user_paper_interactions_record_feed_exclusion
  on public.user_paper_interactions;
create trigger user_paper_interactions_record_feed_exclusion
after insert on public.user_paper_interactions
for each row
execute function private.record_user_paper_feed_exclusion();
