create or replace function public.require_friend_requester_identity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.collaboration_identities
    where owner_id = new.requester_id
  ) then
    raise exception 'public_profile_required' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger friend_requester_identity_required
before insert on public.friend_requests
for each row execute function public.require_friend_requester_identity();
