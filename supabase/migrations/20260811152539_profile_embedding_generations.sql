alter table public.profiles
  add column if not exists embedding_input_generation bigint not null default 0;

alter table public.user_profile_embeddings
  add column if not exists input_generation bigint not null default 0;

create or replace function private.bump_profile_embedding_generation_for_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_owner_id text;
  new_owner_id text;
begin
  if tg_op <> 'INSERT' then
    old_owner_id := old.owner_id;
  end if;
  if tg_op <> 'DELETE' then
    new_owner_id := new.owner_id;
  end if;

  update public.profiles
  set embedding_input_generation = embedding_input_generation + 1
  where owner_id = old_owner_id
     or owner_id = new_owner_id;

  return coalesce(new, old);
end;
$$;

create or replace function private.bump_profile_embedding_generation_for_playlist()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_owner_id text;
  new_owner_id text;
begin
  if tg_op <> 'INSERT' and old.name = 'Read later' then
    old_owner_id := old.owner_id;
  end if;
  if tg_op <> 'DELETE' and new.name = 'Read later' then
    new_owner_id := new.owner_id;
  end if;

  update public.profiles
  set embedding_input_generation = embedding_input_generation + 1
  where owner_id = old_owner_id
     or owner_id = new_owner_id;

  return coalesce(new, old);
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
    where id = old.playlist_id and name = 'Read later';
  end if;
  if tg_op <> 'DELETE' then
    select owner_id into new_owner_id
    from public.playlists
    where id = new.playlist_id and name = 'Read later';
  end if;

  update public.profiles
  set embedding_input_generation = embedding_input_generation + 1
  where owner_id = old_owner_id
     or owner_id = new_owner_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists user_interests_bump_profile_embedding_generation on public.user_interests;
create trigger user_interests_bump_profile_embedding_generation
after insert or update or delete on public.user_interests
for each row execute function private.bump_profile_embedding_generation_for_owner();

drop trigger if exists favorites_bump_profile_embedding_generation on public.favorites;
create trigger favorites_bump_profile_embedding_generation
after insert or update or delete on public.favorites
for each row execute function private.bump_profile_embedding_generation_for_owner();

drop trigger if exists user_paper_interactions_bump_profile_embedding_generation on public.user_paper_interactions;
create trigger user_paper_interactions_bump_profile_embedding_generation
after insert or update or delete on public.user_paper_interactions
for each row execute function private.bump_profile_embedding_generation_for_owner();

drop trigger if exists playlists_bump_profile_embedding_generation on public.playlists;
create trigger playlists_bump_profile_embedding_generation
after insert or update of owner_id, name or delete on public.playlists
for each row execute function private.bump_profile_embedding_generation_for_playlist();

drop trigger if exists playlist_items_insert_delete_bump_profile_embedding_generation on public.playlist_items;
create trigger playlist_items_insert_delete_bump_profile_embedding_generation
after insert or delete on public.playlist_items
for each row execute function private.bump_profile_embedding_generation_for_playlist_item();

drop trigger if exists playlist_items_update_bump_profile_embedding_generation on public.playlist_items;
create trigger playlist_items_update_bump_profile_embedding_generation
after update of playlist_id, paper_id on public.playlist_items
for each row
when (old.playlist_id is distinct from new.playlist_id or old.paper_id is distinct from new.paper_id)
execute function private.bump_profile_embedding_generation_for_playlist_item();
