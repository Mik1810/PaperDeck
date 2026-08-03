create or replace function public.respond_research_group_invitation_in_app(
  p_actor_id text,
  p_invitation_id uuid,
  p_accept boolean
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  invitation_status public.research_group_invitation_status;
  invitation_token_digest text;
begin
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'invitation_unavailable' using errcode = 'P0001';
  end if;

  select invitation.status, invitation.token_digest
  into invitation_status, invitation_token_digest
  from public.research_group_invitations as invitation
  where invitation.id = p_invitation_id
    and invitation.recipient_id = p_actor_id
  for update;

  if not found then
    raise exception 'invitation_unavailable' using errcode = 'P0001';
  end if;

  if invitation_status = 'accepted' and p_accept then
    return 'accepted';
  end if;
  if invitation_status = 'declined' and not p_accept then
    return 'declined';
  end if;
  if invitation_status <> 'pending' or invitation_token_digest is null then
    raise exception 'invitation_unavailable' using errcode = 'P0001';
  end if;

  return public.respond_research_group_invitation(
    p_actor_id,
    p_invitation_id,
    invitation_token_digest,
    p_accept
  );
end;
$$;

revoke all on function public.respond_research_group_invitation_in_app(
  text, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.respond_research_group_invitation_in_app(
  text, uuid, boolean
) to service_role;
