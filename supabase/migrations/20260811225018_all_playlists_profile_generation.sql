create or replace function private.bump_profile_embedding_generation_for_playlist()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_owner_id text;
  new_owner_id text;
begin
  if tg_op = 'DELETE' then
    old_owner_id := old.owner_id;
  elsif tg_op = 'UPDATE' and old.owner_id is distinct from new.owner_id then
    old_owner_id := old.owner_id;
    new_owner_id := new.owner_id;
  end if;

  update public.profiles
  set embedding_input_generation = embedding_input_generation + 1
  where owner_id = old_owner_id
     or owner_id = new_owner_id;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function private.bump_profile_embedding_generation_for_playlist_item()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_owner_id text;
  new_owner_id text;
begin
  if tg_op <> 'INSERT' then
    select owner_id into old_owner_id
    from public.playlists
    where id = old.playlist_id;
  end if;
  if tg_op <> 'DELETE' then
    select owner_id into new_owner_id
    from public.playlists
    where id = new.playlist_id;
  end if;

  update public.profiles
  set embedding_input_generation = embedding_input_generation + 1
  where owner_id = old_owner_id
     or owner_id = new_owner_id;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

update public.profiles as profile
set embedding_input_generation = profile.embedding_input_generation + 1
where exists (
  select 1
  from public.user_profile_embeddings as embedding
  where embedding.owner_id = profile.owner_id
);
