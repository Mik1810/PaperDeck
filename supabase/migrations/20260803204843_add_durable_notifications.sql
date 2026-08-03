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

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id text not null
    references public.profiles(owner_id) on delete cascade,
  actor_id text
    references public.profiles(owner_id) on delete set null,
  type public.notification_type not null,
  dedupe_key text not null,
  friend_request_id uuid
    references public.friend_requests(id) on delete cascade,
  group_invitation_id uuid
    references public.research_group_invitations(id) on delete cascade,
  group_id uuid
    references public.research_groups(id) on delete cascade,
  read_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  constraint notifications_recipient_dedupe_key
    unique (recipient_id, dedupe_key),
  constraint notifications_dedupe_key_check
    check (char_length(dedupe_key) between 1 and 240),
  constraint notifications_expiry_check
    check (expires_at > created_at),
  constraint notifications_source_check
    check (
      (
        type in ('friend_request_received', 'friendship_accepted')
        and friend_request_id is not null
        and group_invitation_id is null
        and group_id is null
      )
      or (
        type in ('group_invitation_received', 'group_invitation_accepted')
        and friend_request_id is null
        and group_invitation_id is not null
        and group_id is not null
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
      )
    )
);

create index notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc, id desc);
create index notifications_recipient_unread_idx
  on public.notifications (recipient_id, created_at desc, id desc)
  where read_at is null and archived_at is null;
create index notifications_actor_idx
  on public.notifications (actor_id)
  where actor_id is not null;
create index notifications_friend_request_idx
  on public.notifications (friend_request_id)
  where friend_request_id is not null;
create index notifications_group_invitation_idx
  on public.notifications (group_invitation_id)
  where group_invitation_id is not null;
create index notifications_group_idx
  on public.notifications (group_id)
  where group_id is not null;
create index notifications_expiry_idx
  on public.notifications (expires_at);

alter table public.notifications enable row level security;

create policy notifications_recipient_read
  on public.notifications
  for select
  to authenticated
  using (recipient_id = ((select auth.jwt()) ->> 'sub'));

create policy notifications_recipient_update
  on public.notifications
  for update
  to authenticated
  using (recipient_id = ((select auth.jwt()) ->> 'sub'))
  with check (recipient_id = ((select auth.jwt()) ->> 'sub'));

revoke all on table public.notifications from public, anon, authenticated;
grant select on table public.notifications to authenticated;
grant update (read_at, archived_at) on table public.notifications
  to authenticated;

create or replace function private.enqueue_notification(
  p_recipient_id text,
  p_type public.notification_type,
  p_dedupe_key text,
  p_actor_id text default null,
  p_friend_request_id uuid default null,
  p_group_invitation_id uuid default null,
  p_group_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  notification_id uuid;
begin
  insert into public.notifications (
    recipient_id,
    actor_id,
    type,
    dedupe_key,
    friend_request_id,
    group_invitation_id,
    group_id
  ) values (
    p_recipient_id,
    p_actor_id,
    p_type,
    p_dedupe_key,
    p_friend_request_id,
    p_group_invitation_id,
    p_group_id
  )
  on conflict (recipient_id, dedupe_key) do nothing
  returning id into notification_id;

  if notification_id is null then
    select notification.id
    into notification_id
    from public.notifications as notification
    where notification.recipient_id = p_recipient_id
      and notification.dedupe_key = p_dedupe_key;
  end if;

  return notification_id;
end;
$$;

create or replace function private.purge_expired_notifications(
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
    raise exception 'invalid_notification_purge_batch'
      using errcode = '22023';
  end if;

  with expired as (
    select notification.id
    from public.notifications as notification
    where notification.expires_at <= now()
    order by notification.expires_at, notification.id
    limit p_batch_size
    for update skip locked
  )
  delete from public.notifications as notification
  using expired
  where notification.id = expired.id;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace function private.notify_friend_request_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.enqueue_notification(
      new.recipient_id,
      'friend_request_received'::public.notification_type,
      'friend-request:' || new.id::text || ':received',
      new.requester_id,
      new.id
    );
  elsif old.status is distinct from new.status and new.status = 'accepted' then
    perform private.enqueue_notification(
      new.requester_id,
      'friendship_accepted'::public.notification_type,
      'friend-request:' || new.id::text || ':accepted',
      new.recipient_id,
      new.id
    );
  end if;

  return new;
end;
$$;

create trigger notify_friend_request_change_trigger
after insert or update of status on public.friend_requests
for each row execute function private.notify_friend_request_change();

create or replace function private.notify_group_invitation_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.enqueue_notification(
      new.recipient_id,
      'group_invitation_received'::public.notification_type,
      'group-invitation:' || new.id::text || ':received',
      new.inviter_id,
      null,
      new.id,
      new.group_id
    );
  elsif old.status is distinct from new.status and new.status = 'accepted' then
    perform private.enqueue_notification(
      new.inviter_id,
      'group_invitation_accepted'::public.notification_type,
      'group-invitation:' || new.id::text || ':accepted',
      new.recipient_id,
      null,
      new.id,
      new.group_id
    );
  end if;

  return new;
end;
$$;

create trigger notify_group_invitation_change_trigger
after insert or update of status on public.research_group_invitations
for each row execute function private.notify_group_invitation_change();

create or replace function private.notify_group_membership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation_inviter_id text;
  notification_recipient record;
begin
  if (
    (tg_op = 'INSERT' and new.role <> 'owner')
    or (
      tg_op = 'UPDATE'
      and old.revoked_at is not null
      and new.revoked_at is null
    )
  ) then
    select invitation.inviter_id
    into invitation_inviter_id
    from public.research_group_invitations as invitation
    where invitation.group_id = new.group_id
      and invitation.recipient_id = new.member_id
      and invitation.status in ('pending', 'accepted')
    order by invitation.created_at desc
    limit 1;

    for notification_recipient in
      select membership.member_id
      from public.research_group_members as membership
      where membership.group_id = new.group_id
        and membership.revoked_at is null
        and membership.member_id <> new.member_id
        and membership.member_id is distinct from invitation_inviter_id
      order by membership.member_id
    loop
      perform private.enqueue_notification(
        notification_recipient.member_id,
        'group_member_joined'::public.notification_type,
        'group-member:' || new.group_id::text || ':' || new.member_id
          || ':joined:' || extract(epoch from new.joined_at)::text,
        new.member_id,
        null,
        null,
        new.group_id
      );
    end loop;
  end if;

  if tg_op = 'UPDATE'
    and old.role is distinct from new.role
    and new.revoked_at is null then
    perform private.enqueue_notification(
      new.member_id,
      case
        when new.role = 'owner'
          then 'group_ownership_transferred'::public.notification_type
        else 'group_role_changed'::public.notification_type
      end,
      'group-member:' || new.group_id::text || ':' || new.member_id
        || ':role:' || new.role::text || ':'
        || extract(epoch from new.updated_at)::text,
      null,
      null,
      null,
      new.group_id
    );
  end if;

  if tg_op = 'UPDATE'
    and old.revoked_at is null
    and new.revoked_at is not null then
    perform private.enqueue_notification(
      new.member_id,
      'group_membership_ended'::public.notification_type,
      'group-member:' || new.group_id::text || ':' || new.member_id
        || ':ended:' || extract(epoch from new.revoked_at)::text,
      null,
      null,
      null,
      new.group_id
    );
  end if;

  return new;
end;
$$;

create trigger notify_group_membership_change_trigger
after insert or update of role, revoked_at on public.research_group_members
for each row execute function private.notify_group_membership_change();

revoke all on function private.enqueue_notification(
  text,
  public.notification_type,
  text,
  text,
  uuid,
  uuid,
  uuid
) from public, anon, authenticated, service_role;
revoke all on function private.purge_expired_notifications(integer)
  from public, anon, authenticated, service_role;
revoke all on function private.notify_friend_request_change()
  from public, anon, authenticated, service_role;
revoke all on function private.notify_group_invitation_change()
  from public, anon, authenticated, service_role;
revoke all on function private.notify_group_membership_change()
  from public, anon, authenticated, service_role;

comment on table public.notifications is
  'Recipient-owned durable notifications. Source rows remain authoritative; no email, rendered message, token, or free-form payload is stored.';
comment on function private.enqueue_notification(
  text,
  public.notification_type,
  text,
  text,
  uuid,
  uuid,
  uuid
) is
  'Internal idempotent notification insert used only by database triggers.';
comment on function private.purge_expired_notifications(integer) is
  'Deletes at most the requested number of notifications after their 90-day retention window.';
