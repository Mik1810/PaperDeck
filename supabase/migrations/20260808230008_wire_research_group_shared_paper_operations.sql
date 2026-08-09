alter table public.notifications
  drop constraint notifications_source_check;

alter table public.notifications
  add constraint notifications_source_check
  check (
    (
      type in ('friend_request_received', 'friendship_accepted')
      and friend_request_id is not null
      and group_invitation_id is null
      and group_id is null
      and group_paper_activity_id is null
    )
    or (
      type in ('group_invitation_received', 'group_invitation_accepted')
      and friend_request_id is null
      and group_invitation_id is not null
      and group_id is not null
      and group_paper_activity_id is null
    )
    or (
      type in (
        'group_member_joined',
        'group_membership_ended',
        'group_role_changed',
        'group_ownership_transferred'
      )
      and friend_request_id is null
      and group_invitation_id is null
      and group_id is not null
      and group_paper_activity_id is null
    )
    or (
      type in ('group_papers_added', 'group_paper_removed')
      and friend_request_id is null
      and group_invitation_id is null
      and group_id is not null
      and group_paper_activity_id is not null
    )
  );

create or replace function public.add_research_group_paper(
  p_actor_id text,
  p_group_id uuid,
  p_paper_id uuid
)
returns table (changed boolean, activity_id uuid)
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  actor_role public.research_group_role;
  inserted_paper_id uuid;
  current_count integer;
  activity_bucket timestamptz;
  current_activity_id uuid;
  operation_time timestamptz := now();
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
  if not found then
    raise exception 'research_group_unavailable' using errcode = 'P0001';
  end if;

  select membership.role
  into actor_role
  from public.research_group_members as membership
  where membership.group_id = p_group_id
    and membership.member_id = p_actor_id
    and membership.revoked_at is null
  for share;
  if actor_role is null then
    raise exception 'research_group_unavailable' using errcode = 'P0001';
  end if;

  perform 1 from public.papers where id = p_paper_id;
  if not found then
    raise exception 'research_group_paper_unavailable' using errcode = 'P0001';
  end if;

  select count(*)::integer
  into current_count
  from public.research_group_paper_items
  where group_id = p_group_id;

  insert into public.research_group_paper_items (
    group_id,
    paper_id,
    added_by,
    added_at
  ) values (
    p_group_id,
    p_paper_id,
    p_actor_id,
    operation_time
  )
  on conflict (group_id, paper_id) do nothing
  returning paper_id into inserted_paper_id;

  if inserted_paper_id is null then
    return query select false, null::uuid;
    return;
  end if;

  if current_count >= 500 then
    raise exception 'research_group_paper_limit_reached' using errcode = 'P0001';
  end if;

  activity_bucket := date_bin(
    interval '10 minutes',
    operation_time,
    timestamptz '2001-01-01 00:00:00+00'
  );

  insert into public.research_group_paper_activity (
    group_id,
    kind,
    actor_id,
    representative_paper_id,
    event_count,
    bucket_started_at,
    first_occurred_at,
    last_occurred_at,
    expires_at
  ) values (
    p_group_id,
    'papers_added',
    p_actor_id,
    p_paper_id,
    1,
    activity_bucket,
    operation_time,
    operation_time,
    operation_time + interval '90 days'
  )
  on conflict (group_id, actor_id, kind, bucket_started_at)
  do update set
    representative_paper_id = excluded.representative_paper_id,
    event_count = public.research_group_paper_activity.event_count + 1,
    last_occurred_at = excluded.last_occurred_at,
    expires_at = excluded.expires_at
  returning id into current_activity_id;

  insert into public.notifications (
    recipient_id,
    actor_id,
    type,
    dedupe_key,
    group_id,
    group_paper_activity_id,
    created_at,
    expires_at
  )
  select
    membership.member_id,
    p_actor_id,
    'group_papers_added'::public.notification_type,
    'group-paper-activity:' || current_activity_id::text,
    p_group_id,
    current_activity_id,
    operation_time,
    operation_time + interval '90 days'
  from public.research_group_members as membership
  where membership.group_id = p_group_id
    and membership.revoked_at is null
    and membership.member_id <> p_actor_id
    and membership.paper_notification_preference = 'all'
  on conflict (recipient_id, dedupe_key)
  do update set
    read_at = null,
    archived_at = null,
    created_at = excluded.created_at,
    expires_at = excluded.expires_at;

  return query select true, current_activity_id;
end;
$$;

create or replace function public.remove_research_group_paper(
  p_actor_id text,
  p_group_id uuid,
  p_paper_id uuid
)
returns table (changed boolean, activity_id uuid)
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  actor_role public.research_group_role;
  original_contributor_id text;
  current_activity_id uuid;
  operation_time timestamptz := now();
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
  if not found then
    raise exception 'research_group_unavailable' using errcode = 'P0001';
  end if;

  select membership.role
  into actor_role
  from public.research_group_members as membership
  where membership.group_id = p_group_id
    and membership.member_id = p_actor_id
    and membership.revoked_at is null
  for share;
  if actor_role is null then
    raise exception 'research_group_unavailable' using errcode = 'P0001';
  end if;

  select item.added_by
  into original_contributor_id
  from public.research_group_paper_items as item
  where item.group_id = p_group_id and item.paper_id = p_paper_id
  for update;
  if not found then
    return query select false, null::uuid;
    return;
  end if;

  if actor_role = 'member'
    and original_contributor_id is distinct from p_actor_id then
    raise exception 'research_group_unavailable' using errcode = 'P0001';
  end if;

  delete from public.research_group_paper_items
  where group_id = p_group_id and paper_id = p_paper_id;

  insert into public.research_group_paper_activity (
    group_id,
    kind,
    actor_id,
    representative_paper_id,
    event_count,
    bucket_started_at,
    first_occurred_at,
    last_occurred_at,
    expires_at
  ) values (
    p_group_id,
    'paper_removed',
    p_actor_id,
    p_paper_id,
    1,
    null,
    operation_time,
    operation_time,
    operation_time + interval '90 days'
  )
  returning id into current_activity_id;

  if original_contributor_id is not null
    and original_contributor_id <> p_actor_id
    and exists (
      select 1
      from public.research_group_members as membership
      where membership.group_id = p_group_id
        and membership.member_id = original_contributor_id
        and membership.revoked_at is null
        and membership.paper_notification_preference in (
          'all',
          'important_only'
        )
    ) then
    insert into public.notifications (
      recipient_id,
      actor_id,
      type,
      dedupe_key,
      group_id,
      group_paper_activity_id,
      created_at,
      expires_at
    ) values (
      original_contributor_id,
      p_actor_id,
      'group_paper_removed',
      'group-paper-activity:' || current_activity_id::text,
      p_group_id,
      current_activity_id,
      operation_time,
      operation_time + interval '90 days'
    );
  end if;

  return query select true, current_activity_id;
end;
$$;

create or replace function private.purge_expired_group_paper_activity(
  p_batch_size integer default 1000
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if p_batch_size < 1 or p_batch_size > 10000 then
    raise exception 'invalid_group_paper_activity_purge_batch'
      using errcode = '22023';
  end if;

  with expired as (
    select activity.id
    from public.research_group_paper_activity as activity
    where activity.expires_at <= now()
    order by activity.expires_at, activity.id
    limit p_batch_size
    for update skip locked
  )
  delete from public.research_group_paper_activity as activity
  using expired
  where activity.id = expired.id;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace function public.set_research_group_paper_notification_preference(
  p_actor_id text,
  p_group_id uuid,
  p_preference public.research_group_paper_notification_preference
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
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
  if not found then
    raise exception 'research_group_unavailable' using errcode = 'P0001';
  end if;

  update public.research_group_members
  set
    paper_notification_preference = p_preference,
    updated_at = now()
  where group_id = p_group_id
    and member_id = p_actor_id
    and revoked_at is null;
  if not found then
    raise exception 'research_group_unavailable' using errcode = 'P0001';
  end if;

  return true;
end;
$$;

revoke all on function public.add_research_group_paper(text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.remove_research_group_paper(text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.purge_expired_group_paper_activity(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.set_research_group_paper_notification_preference(
  text,
  uuid,
  public.research_group_paper_notification_preference
) from public, anon, authenticated;
grant execute on function public.add_research_group_paper(text, uuid, uuid)
  to service_role;
grant execute on function public.remove_research_group_paper(text, uuid, uuid)
  to service_role;
grant execute on function public.set_research_group_paper_notification_preference(
  text,
  uuid,
  public.research_group_paper_notification_preference
) to service_role;

comment on function public.add_research_group_paper(text, uuid, uuid) is
  'Service-role-only idempotent shared-paper add with an in-transaction member recheck and aggregated notifications.';
comment on function public.remove_research_group_paper(text, uuid, uuid) is
  'Service-role-only idempotent shared-paper removal. Members remove only their own additions; owner/admin may moderate all.';
comment on function private.purge_expired_group_paper_activity(integer) is
  'Deletes a bounded batch of minimal group-paper activity after its 90-day retention window.';
comment on function public.set_research_group_paper_notification_preference(
  text,
  uuid,
  public.research_group_paper_notification_preference
) is
  'Service-role-only self preference update with an in-transaction active-membership recheck.';
