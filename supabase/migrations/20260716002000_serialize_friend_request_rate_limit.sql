create or replace function public.enforce_friend_request_rate_limit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('friend-request-rate:' || new.requester_id, 0)
  );
  if (
    select count(*) from public.friend_requests
    where requester_id = new.requester_id
      and created_at > now() - interval '24 hours'
  ) >= 10 then
    raise exception 'friend_request_rate_limited' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger friend_request_rate_limit
before insert on public.friend_requests
for each row execute function public.enforce_friend_request_rate_limit();
