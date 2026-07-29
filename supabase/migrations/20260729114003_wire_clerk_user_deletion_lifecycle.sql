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
  'Service-role-only atomic research-group succession and collaboration identity cleanup for a verified Clerk user.deleted event.';
