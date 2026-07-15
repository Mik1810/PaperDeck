create or replace function public.keep_collaboration_public_id_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.public_id <> old.public_id then
    raise exception 'collaboration_public_id_is_immutable' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger collaboration_identity_public_id_immutable
before update on public.collaboration_identities
for each row execute function public.keep_collaboration_public_id_immutable();
