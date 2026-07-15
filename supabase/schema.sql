-- PaperDeck initial Supabase schema.
-- Version: 0.1.0
-- Auth model:
--   - Clerk handles authentication.
--   - User-owned rows store Clerk user IDs in owner_id.
--   - MVP server routes/actions must enforce owner_id using Clerk auth().userId.
--   - RLS policies are included for the future Clerk JWT integration path.

create extension if not exists pgcrypto;
create extension if not exists vector;

create type paper_access as enum ('open', 'publisher', 'unknown');

create type paper_source as enum (
  'arxiv',
  'semantic_scholar',
  'openalex',
  'dblp',
  'crossref',
  'manual'
);

create type interaction_type as enum (
  'seen',
  'open_detail',
  'dismiss',
  'favorite',
  'save_to_playlist',
  'read',
  'not_interested',
  'already_read'
);

create type group_invite_policy as enum (
  'nobody',
  'friends_only',
  'anyone'
);

create table profiles (
  owner_id text primary key,
  display_name text,
  image_url text,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table collaboration_identities (
  owner_id text primary key references profiles(owner_id) on delete cascade,
  public_id uuid not null default gen_random_uuid() unique,
  email_lookup_hash text not null unique check (email_lookup_hash ~ '^[0-9a-f]{64}$'),
  email_hash_version integer not null default 1 check (email_hash_version > 0),
  discoverable_by_email boolean not null default true,
  group_invite_policy group_invite_policy not null default 'friends_only',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table collaboration_search_limits (
  requester_id text primary key references profiles(owner_id) on delete cascade,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0)
);

create or replace function keep_collaboration_public_id_immutable()
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
before update on collaboration_identities
for each row execute function keep_collaboration_public_id_immutable();

create table taxonomy_topics (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  parent_id uuid references taxonomy_topics(id) on delete set null,
  source text,
  arxiv_category text,
  depth integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table topic_relations (
  source_topic_id uuid not null references taxonomy_topics(id) on delete cascade,
  target_topic_id uuid not null references taxonomy_topics(id) on delete cascade,
  relation_type text not null,
  weight real not null default 1,
  created_at timestamptz not null default now(),
  primary key (source_topic_id, target_topic_id, relation_type)
);

create table papers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  abstract text,
  year integer,
  published_at timestamptz,
  updated_at timestamptz,
  source paper_source not null,
  doi text,
  arxiv_id text,
  semantic_scholar_id text,
  openalex_id text,
  url text not null,
  pdf_url text,
  venue text,
  citation_count integer,
  is_open_access boolean,
  access paper_access not null default 'unknown',
  is_classic boolean not null default false,
  embedding vector(384),
  embedding_model text,
  embedding_dimension integer,
  embedding_content_hash text,
  embedded_at timestamptz,
  triage_summary jsonb,
  triage_summary_model text,
  triage_summary_generated_at timestamptz,
  created_at timestamptz not null default now(),
  ingested_at timestamptz not null default now()
);

create table paper_authors (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references papers(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (paper_id, position)
);

create table paper_topics (
  paper_id uuid not null references papers(id) on delete cascade,
  topic_id uuid not null references taxonomy_topics(id) on delete cascade,
  confidence real,
  source text,
  created_at timestamptz not null default now(),
  primary key (paper_id, topic_id)
);

create table paper_external_ids (
  paper_id uuid not null references papers(id) on delete cascade,
  provider text not null,
  external_id text not null,
  url text,
  created_at timestamptz not null default now(),
  primary key (paper_id, provider, external_id)
);

create table topic_embeddings (
  topic_id uuid not null references taxonomy_topics(id) on delete cascade,
  embedding vector(384) not null,
  embedding_model text not null,
  embedding_dimension integer not null,
  embedding_content_hash text not null,
  embedded_at timestamptz not null default now(),
  primary key (topic_id, embedding_model)
);

create table user_interests (
  owner_id text not null references profiles(owner_id) on delete cascade,
  topic_id uuid not null references taxonomy_topics(id) on delete cascade,
  weight real not null default 1,
  selected_at timestamptz not null default now(),
  primary key (owner_id, topic_id)
);

create table user_profile_embeddings (
  owner_id text not null references profiles(owner_id) on delete cascade,
  embedding vector(384) not null,
  embedding_model text not null,
  embedding_dimension integer not null,
  input_signature text not null,
  generated_at timestamptz not null default now(),
  primary key (owner_id, embedding_model)
);

create table playlists (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references profiles(owner_id) on delete cascade,
  name text not null,
  description text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);

create table playlist_items (
  playlist_id uuid not null references playlists(id) on delete cascade,
  paper_id uuid not null references papers(id) on delete cascade,
  position integer not null default 0,
  added_at timestamptz not null default now(),
  primary key (playlist_id, paper_id)
);

create table favorites (
  owner_id text not null references profiles(owner_id) on delete cascade,
  paper_id uuid not null references papers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, paper_id)
);

create table recommendation_impressions (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references profiles(owner_id) on delete cascade,
  paper_id uuid not null references papers(id) on delete cascade,
  batch_id uuid not null,
  rank integer not null check (rank > 0),
  score real not null,
  score_components jsonb not null default '{}'::jsonb,
  model_version text not null,
  shown_at timestamptz not null default now(),
  unique (owner_id, paper_id, batch_id)
);

create table user_paper_interactions (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references profiles(owner_id) on delete cascade,
  paper_id uuid not null references papers(id) on delete cascade,
  recommendation_impression_id uuid references recommendation_impressions(id) on delete set null,
  action interaction_type not null,
  context text not null default 'feed',
  created_at timestamptz not null default now()
);

create table recommendations (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references profiles(owner_id) on delete cascade,
  paper_id uuid not null references papers(id) on delete cascade,
  score real not null,
  reason text,
  model_version text,
  generated_at timestamptz not null default now(),
  seen_at timestamptz,
  unique (owner_id, paper_id, generated_at)
);

create table digests (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references profiles(owner_id) on delete cascade,
  title text not null,
  generated_at timestamptz not null default now(),
  viewed_at timestamptz
);

create table digest_items (
  digest_id uuid not null references digests(id) on delete cascade,
  paper_id uuid not null references papers(id) on delete cascade,
  position integer not null default 0,
  reason text,
  primary key (digest_id, paper_id)
);

create table paper_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references profiles(owner_id) on delete cascade,
  paper_id uuid not null references papers(id) on delete cascade,
  playlist_id uuid references playlists(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source paper_source not null,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cursor_value text,
  imported_count integer not null default 0,
  error_message text
);

create table ingestion_cursors (
  source paper_source not null,
  cursor_key text not null,
  cursor_value text,
  last_seen_published_at timestamptz,
  last_seen_external_id text,
  last_successful_run_id uuid references ingestion_runs(id) on delete set null,
  imported_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (source, cursor_key)
);

create index taxonomy_topics_parent_idx on taxonomy_topics(parent_id);
create index papers_published_at_idx on papers(published_at desc);
create index papers_year_idx on papers(year desc);
create index papers_source_idx on papers(source);
create index papers_embedding_content_hash_idx on papers(embedding_content_hash)
where embedding_content_hash is not null;
create unique index papers_doi_unique_idx on papers(doi) where doi is not null;
create unique index papers_arxiv_unique_idx on papers(arxiv_id) where arxiv_id is not null;
create unique index papers_semantic_scholar_unique_idx on papers(semantic_scholar_id) where semantic_scholar_id is not null;
create unique index papers_openalex_unique_idx on papers(openalex_id) where openalex_id is not null;
create index paper_topics_topic_idx on paper_topics(topic_id);
create index paper_authors_paper_idx on paper_authors(paper_id);
create index topic_embeddings_model_idx on topic_embeddings(embedding_model);
create index user_profile_embeddings_generated_idx on user_profile_embeddings(owner_id, generated_at desc);
create index playlist_items_paper_idx on playlist_items(paper_id);
create index user_paper_interactions_owner_created_idx on user_paper_interactions(owner_id, created_at desc);
create index user_paper_interactions_recommendation_impression_idx on user_paper_interactions(recommendation_impression_id);
create index recommendation_impressions_owner_shown_idx on recommendation_impressions(owner_id, shown_at desc);
create index recommendation_impressions_owner_batch_rank_idx on recommendation_impressions(owner_id, batch_id, rank);
create index recommendations_owner_model_generated_idx on recommendations(owner_id, model_version, generated_at desc);
create index recommendations_owner_score_idx on recommendations(owner_id, score desc);
create index digests_owner_generated_idx on digests(owner_id, generated_at desc);
create index paper_notes_owner_paper_created_idx on paper_notes(owner_id, paper_id, created_at desc);
create index paper_notes_playlist_idx on paper_notes(playlist_id);
create index ingestion_cursors_updated_idx on ingestion_cursors(updated_at desc);

-- Use cosine distance for the current 384-dimensional embedding model.
create index papers_embedding_cosine_idx on papers using ivfflat (embedding vector_cosine_ops)
with (lists = 100);

alter table profiles enable row level security;
alter table collaboration_identities enable row level security;
alter table collaboration_search_limits enable row level security;
alter table user_interests enable row level security;
alter table playlists enable row level security;
alter table playlist_items enable row level security;
alter table favorites enable row level security;
alter table recommendation_impressions enable row level security;
alter table user_paper_interactions enable row level security;
alter table recommendations enable row level security;
alter table digests enable row level security;
alter table digest_items enable row level security;
alter table paper_notes enable row level security;

alter table taxonomy_topics enable row level security;
alter table topic_relations enable row level security;
alter table papers enable row level security;
alter table paper_authors enable row level security;
alter table paper_topics enable row level security;
alter table paper_external_ids enable row level security;
alter table topic_embeddings enable row level security;
alter table user_profile_embeddings enable row level security;
alter table ingestion_runs enable row level security;
alter table ingestion_cursors enable row level security;

-- Future Clerk JWT integration policy helper:
-- Configure Clerk/Supabase so auth.jwt() ->> 'sub' equals Clerk user ID.
-- Until then, user-specific access should go through trusted server routes/actions.

create policy "profiles_select_own"
on profiles for select
using (owner_id = auth.jwt() ->> 'sub');

create policy "profiles_insert_own"
on profiles for insert
with check (owner_id = auth.jwt() ->> 'sub');

create policy "profiles_update_own"
on profiles for update
using (owner_id = auth.jwt() ->> 'sub')
with check (owner_id = auth.jwt() ->> 'sub');

create policy "collaboration_identities_select_own"
on collaboration_identities for select to authenticated
using (owner_id = auth.jwt() ->> 'sub');

create policy "collaboration_identities_insert_own"
on collaboration_identities for insert to authenticated
with check (owner_id = auth.jwt() ->> 'sub');

create policy "collaboration_identities_update_own"
on collaboration_identities for update to authenticated
using (owner_id = auth.jwt() ->> 'sub')
with check (owner_id = auth.jwt() ->> 'sub');

create policy "collaboration_identities_delete_own"
on collaboration_identities for delete to authenticated
using (owner_id = auth.jwt() ->> 'sub');

create policy "user_interests_own"
on user_interests for all
using (owner_id = auth.jwt() ->> 'sub')
with check (owner_id = auth.jwt() ->> 'sub');

create policy "playlists_own"
on playlists for all
using (owner_id = auth.jwt() ->> 'sub')
with check (owner_id = auth.jwt() ->> 'sub');

create policy "playlist_items_own"
on playlist_items for all
using (
  exists (
    select 1
    from playlists
    where playlists.id = playlist_items.playlist_id
      and playlists.owner_id = auth.jwt() ->> 'sub'
  )
)
with check (
  exists (
    select 1
    from playlists
    where playlists.id = playlist_items.playlist_id
      and playlists.owner_id = auth.jwt() ->> 'sub'
  )
);

create policy "favorites_own"
on favorites for all
using (owner_id = auth.jwt() ->> 'sub')
with check (owner_id = auth.jwt() ->> 'sub');

create policy "recommendation_impressions_own"
on recommendation_impressions for all
using (owner_id = auth.jwt() ->> 'sub')
with check (owner_id = auth.jwt() ->> 'sub');

create policy "user_paper_interactions_own"
on user_paper_interactions for all
using (owner_id = auth.jwt() ->> 'sub')
with check (owner_id = auth.jwt() ->> 'sub');

create policy "recommendations_own"
on recommendations for all
using (owner_id = auth.jwt() ->> 'sub')
with check (owner_id = auth.jwt() ->> 'sub');

create policy "digests_own"
on digests for all
using (owner_id = auth.jwt() ->> 'sub')
with check (owner_id = auth.jwt() ->> 'sub');

create policy "paper_notes_own"
on paper_notes for all
using (owner_id = auth.jwt() ->> 'sub')
with check (owner_id = auth.jwt() ->> 'sub');

create policy "digest_items_own"
on digest_items for all
using (
  exists (
    select 1
    from digests
    where digests.id = digest_items.digest_id
      and digests.owner_id = auth.jwt() ->> 'sub'
  )
)
with check (
  exists (
    select 1
    from digests
    where digests.id = digest_items.digest_id
      and digests.owner_id = auth.jwt() ->> 'sub'
  )
);

-- Authenticated users may read shared catalog data after Clerk JWT integration.
create policy "taxonomy_topics_read_authenticated"
on taxonomy_topics for select
using (auth.jwt() ->> 'sub' is not null);

create policy "topic_relations_read_authenticated"
on topic_relations for select
using (auth.jwt() ->> 'sub' is not null);

create policy "papers_read_authenticated"
on papers for select
using (auth.jwt() ->> 'sub' is not null);

create policy "paper_authors_read_authenticated"
on paper_authors for select
using (auth.jwt() ->> 'sub' is not null);

create policy "paper_topics_read_authenticated"
on paper_topics for select
using (auth.jwt() ->> 'sub' is not null);

create policy "paper_external_ids_read_authenticated"
on paper_external_ids for select
using (auth.jwt() ->> 'sub' is not null);

create policy "topic_embeddings_read_authenticated"
on topic_embeddings for select
using (auth.jwt() ->> 'sub' is not null);

create policy "user_profile_embeddings_own"
on user_profile_embeddings for all
using (owner_id = auth.jwt() ->> 'sub')
with check (owner_id = auth.jwt() ->> 'sub');

create or replace function find_collaboration_profile(p_email_lookup_hash text)
returns table (
  public_id uuid,
  display_name text,
  image_url text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester text := auth.jwt() ->> 'sub';
  current_attempt_count integer;
begin
  if requester is null or requester = '' then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if p_email_lookup_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  insert into collaboration_search_limits as limits (
    requester_id, window_started_at, attempt_count
  ) values (requester, now(), 1)
  on conflict (requester_id) do update set
    window_started_at = case
      when limits.window_started_at <= now() - interval '1 minute' then now()
      else limits.window_started_at
    end,
    attempt_count = case
      when limits.window_started_at <= now() - interval '1 minute' then 1
      else limits.attempt_count + 1
    end
  returning attempt_count into current_attempt_count;

  if current_attempt_count > 10 then
    raise exception 'rate_limit_exceeded' using errcode = 'P0001';
  end if;

  return query
  select identity.public_id, profile.display_name, profile.image_url
  from collaboration_identities identity
  join profiles profile on profile.owner_id = identity.owner_id
  where identity.email_lookup_hash = p_email_lookup_hash
    and identity.discoverable_by_email
    and identity.owner_id <> requester
    and profile.display_name is not null
    and position('@' in profile.display_name) = 0
    and char_length(btrim(profile.display_name)) between 2 and 50
  limit 1;
end;
$$;

revoke all on function find_collaboration_profile(text) from public;
revoke all on function find_collaboration_profile(text) from anon;
grant execute on function find_collaboration_profile(text) to authenticated;

create or replace function match_papers_by_embedding(
  query_embedding vector(384),
  match_count integer default 100,
  embedding_model_filter text default 'sentence-transformers/all-MiniLM-L6-v2'
)
returns table (
  paper_id uuid,
  semantic_score real
)
language sql
stable
set search_path = public
as $$
  select
    papers.id as paper_id,
    (1 - (papers.embedding <=> query_embedding))::real as semantic_score
  from papers
  where papers.embedding is not null
    and (
      embedding_model_filter is null
      or papers.embedding_model = embedding_model_filter
    )
  order by papers.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 500);
$$;

-- Mutual friendships and user blocks. Kept after catalog functions so the
-- replacement discovery function can add relationship state.
create type public.friend_request_status as enum (
  'pending',
  'accepted',
  'declined',
  'cancelled'
);

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id text not null references public.profiles(owner_id) on delete cascade,
  recipient_id text not null references public.profiles(owner_id) on delete cascade,
  status public.friend_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  updated_at timestamptz not null default now(),
  check (requester_id <> recipient_id)
);

create unique index friend_requests_one_pending_pair_idx
  on public.friend_requests (
    least(requester_id, recipient_id),
    greatest(requester_id, recipient_id)
  )
  where status = 'pending';
create index friend_requests_requester_created_idx
  on public.friend_requests (requester_id, created_at desc);
create index friend_requests_recipient_status_idx
  on public.friend_requests (recipient_id, status, created_at desc);

create table public.friendships (
  user_low_id text not null references public.profiles(owner_id) on delete cascade,
  user_high_id text not null references public.profiles(owner_id) on delete cascade,
  accepted_request_id uuid references public.friend_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_low_id, user_high_id),
  check (user_low_id < user_high_id)
);
create index friendships_high_user_idx
  on public.friendships (user_high_id, created_at desc);

create table public.user_blocks (
  blocker_id text not null references public.profiles(owner_id) on delete cascade,
  blocked_id text not null references public.profiles(owner_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index user_blocks_blocked_idx on public.user_blocks (blocked_id);

alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.user_blocks enable row level security;

create policy friend_requests_participant_read
  on public.friend_requests for select to authenticated
  using ((auth.jwt() ->> 'sub') in (requester_id, recipient_id));

create policy friendships_participant_read
  on public.friendships for select to authenticated
  using ((auth.jwt() ->> 'sub') in (user_low_id, user_high_id));

create policy user_blocks_blocker_read
  on public.user_blocks for select to authenticated
  using (blocker_id = (auth.jwt() ->> 'sub'));

create or replace function public.send_friend_request(p_target_public_id uuid)
returns table (relationship_status text, request_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor text := auth.jwt() ->> 'sub';
  target text;
  existing_id uuid;
  existing_requester text;
  low_id text;
  high_id text;
begin
  select owner_id into target
  from public.collaboration_identities
  where public_id = p_target_public_id;

  if actor is null or target is null or actor = target then
    raise exception 'profile_unavailable' using errcode = 'P0001';
  end if;

  low_id := least(actor, target);
  high_id := greatest(actor, target);
  perform pg_advisory_xact_lock(hashtextextended(low_id || ':' || high_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('friend-request-rate:' || actor, 0));

  if exists (
    select 1 from public.user_blocks
    where (blocker_id = actor and blocked_id = target)
       or (blocker_id = target and blocked_id = actor)
  ) then
    raise exception 'profile_unavailable' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.friendships
    where user_low_id = low_id and user_high_id = high_id
  ) then
    return query select 'friends'::text, null::uuid;
    return;
  end if;

  select id, requester_id into existing_id, existing_requester
  from public.friend_requests
  where least(requester_id, recipient_id) = low_id
    and greatest(requester_id, recipient_id) = high_id
    and status = 'pending'
  limit 1;

  if existing_id is not null then
    if existing_requester = actor then
      return query select 'outgoing_pending'::text, existing_id;
      return;
    end if;

    update public.friend_requests
    set status = 'accepted', responded_at = now(), updated_at = now()
    where id = existing_id;
    insert into public.friendships (
      user_low_id, user_high_id, accepted_request_id
    ) values (low_id, high_id, existing_id)
    on conflict (user_low_id, user_high_id) do nothing;
    return query select 'friends'::text, existing_id;
    return;
  end if;

  if exists (
    select 1 from public.friend_requests
    where requester_id = actor
      and recipient_id = target
      and status = 'declined'
      and responded_at > now() - interval '30 days'
  ) then
    raise exception 'friend_request_cooldown' using errcode = 'P0001';
  end if;

  if (
    select count(*) from public.friend_requests
    where requester_id = actor
      and created_at > now() - interval '24 hours'
  ) >= 10 then
    raise exception 'friend_request_rate_limited' using errcode = 'P0001';
  end if;

  insert into public.friend_requests (requester_id, recipient_id)
  values (actor, target)
  returning id into existing_id;
  return query select 'outgoing_pending'::text, existing_id;
end;
$$;

create or replace function public.respond_friend_request(
  p_request_id uuid,
  p_accept boolean
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor text := auth.jwt() ->> 'sub';
  request_row public.friend_requests%rowtype;
  low_id text;
  high_id text;
begin
  select * into request_row from public.friend_requests where id = p_request_id;
  if actor is null or request_row.id is null or request_row.recipient_id <> actor then
    raise exception 'request_unavailable' using errcode = 'P0001';
  end if;

  low_id := least(request_row.requester_id, request_row.recipient_id);
  high_id := greatest(request_row.requester_id, request_row.recipient_id);
  perform pg_advisory_xact_lock(hashtextextended(low_id || ':' || high_id, 0));
  select * into request_row from public.friend_requests where id = p_request_id for update;

  if request_row.status = 'accepted' then return 'friends'; end if;
  if request_row.status = 'declined' then return 'declined'; end if;
  if request_row.status <> 'pending' then return 'cancelled'; end if;

  if exists (
    select 1 from public.user_blocks
    where (blocker_id = request_row.requester_id and blocked_id = request_row.recipient_id)
       or (blocker_id = request_row.recipient_id and blocked_id = request_row.requester_id)
  ) then
    update public.friend_requests
    set status = 'cancelled', responded_at = now(), updated_at = now()
    where id = p_request_id;
    raise exception 'request_unavailable' using errcode = 'P0001';
  end if;

  if p_accept then
    update public.friend_requests
    set status = 'accepted', responded_at = now(), updated_at = now()
    where id = p_request_id;
    insert into public.friendships (
      user_low_id, user_high_id, accepted_request_id
    ) values (low_id, high_id, p_request_id)
    on conflict (user_low_id, user_high_id) do nothing;
    return 'friends';
  end if;

  update public.friend_requests
  set status = 'declined', responded_at = now(), updated_at = now()
  where id = p_request_id;
  return 'declined';
end;
$$;

create or replace function public.cancel_friend_request(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor text := auth.jwt() ->> 'sub';
  request_row public.friend_requests%rowtype;
begin
  select * into request_row
  from public.friend_requests where id = p_request_id for update;
  if actor is null or request_row.id is null or request_row.requester_id <> actor then
    raise exception 'request_unavailable' using errcode = 'P0001';
  end if;
  if request_row.status = 'pending' then
    update public.friend_requests
    set status = 'cancelled', responded_at = now(), updated_at = now()
    where id = p_request_id;
  end if;
  return request_row.status::text;
end;
$$;

create or replace function public.unfriend_profile(p_target_public_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor text := auth.jwt() ->> 'sub';
  target text;
begin
  select owner_id into target from public.collaboration_identities
  where public_id = p_target_public_id;
  if actor is null or target is null or actor = target then
    raise exception 'profile_unavailable' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(least(actor, target) || ':' || greatest(actor, target), 0)
  );
  delete from public.friendships
  where user_low_id = least(actor, target)
    and user_high_id = greatest(actor, target);
  return true;
end;
$$;

create or replace function public.block_profile(p_target_public_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor text := auth.jwt() ->> 'sub';
  target text;
begin
  select owner_id into target from public.collaboration_identities
  where public_id = p_target_public_id;
  if actor is null or target is null or actor = target then
    raise exception 'profile_unavailable' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(least(actor, target) || ':' || greatest(actor, target), 0)
  );
  insert into public.user_blocks (blocker_id, blocked_id)
  values (actor, target) on conflict do nothing;
  delete from public.friendships
  where user_low_id = least(actor, target)
    and user_high_id = greatest(actor, target);
  update public.friend_requests
  set status = 'cancelled', responded_at = now(), updated_at = now()
  where status = 'pending'
    and least(requester_id, recipient_id) = least(actor, target)
    and greatest(requester_id, recipient_id) = greatest(actor, target);
  return true;
end;
$$;

create or replace function public.unblock_profile(p_target_public_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor text := auth.jwt() ->> 'sub';
  target text;
begin
  select owner_id into target from public.collaboration_identities
  where public_id = p_target_public_id;
  if actor is null or target is null or actor = target then
    raise exception 'profile_unavailable' using errcode = 'P0001';
  end if;
  delete from public.user_blocks where blocker_id = actor and blocked_id = target;
  return true;
end;
$$;

drop function public.find_collaboration_profile(text);
create function public.find_collaboration_profile(p_email_lookup_hash text)
returns table (
  public_id uuid,
  display_name text,
  image_url text,
  relationship_status text,
  request_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester text := auth.jwt() ->> 'sub';
  current_attempt_count integer;
begin
  if requester is null or requester = '' then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_email_lookup_hash !~ '^[0-9a-f]{64}$' then return; end if;

  insert into public.collaboration_search_limits as limits (
    requester_id, window_started_at, attempt_count
  ) values (requester, now(), 1)
  on conflict (requester_id) do update set
    window_started_at = case
      when limits.window_started_at <= now() - interval '1 minute' then now()
      else limits.window_started_at end,
    attempt_count = case
      when limits.window_started_at <= now() - interval '1 minute' then 1
      else limits.attempt_count + 1 end
  returning attempt_count into current_attempt_count;
  if current_attempt_count > 10 then
    raise exception 'rate_limit_exceeded' using errcode = 'P0001';
  end if;

  return query
  select identity.public_id, profile.display_name, profile.image_url,
    case
      when friendship.user_low_id is not null then 'friends'
      when pending.requester_id = requester then 'outgoing_pending'
      when pending.recipient_id = requester then 'incoming_pending'
      else 'none'
    end,
    pending.id
  from public.collaboration_identities identity
  join public.profiles profile on profile.owner_id = identity.owner_id
  left join public.friendships friendship
    on friendship.user_low_id = least(requester, identity.owner_id)
   and friendship.user_high_id = greatest(requester, identity.owner_id)
  left join lateral (
    select request.id, request.requester_id, request.recipient_id
    from public.friend_requests request
    where request.status = 'pending'
      and least(request.requester_id, request.recipient_id) = least(requester, identity.owner_id)
      and greatest(request.requester_id, request.recipient_id) = greatest(requester, identity.owner_id)
    limit 1
  ) pending on true
  where identity.email_lookup_hash = p_email_lookup_hash
    and identity.discoverable_by_email
    and identity.owner_id <> requester
    and profile.display_name is not null
    and position('@' in profile.display_name) = 0
    and char_length(btrim(profile.display_name)) between 2 and 50
    and not exists (
      select 1 from public.user_blocks block
      where (block.blocker_id = requester and block.blocked_id = identity.owner_id)
         or (block.blocker_id = identity.owner_id and block.blocked_id = requester)
    )
  limit 1;
end;
$$;

create or replace function public.list_collaboration_connections()
returns table (
  public_id uuid,
  display_name text,
  image_url text,
  relationship_status text,
  request_id uuid,
  occurred_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with actor as (select auth.jwt() ->> 'sub' as id),
  connections as (
  select identity.public_id, profile.display_name, profile.image_url,
    case when request.requester_id = actor.id
      then 'outgoing_pending' else 'incoming_pending' end,
    request.id, request.created_at as occurred_at
  from actor
  join public.friend_requests request
    on actor.id in (request.requester_id, request.recipient_id)
   and request.status = 'pending'
  join public.collaboration_identities identity
    on identity.owner_id = case when request.requester_id = actor.id
      then request.recipient_id else request.requester_id end
  join public.profiles profile on profile.owner_id = identity.owner_id
  union all
  select identity.public_id, profile.display_name, profile.image_url,
    'friends', null::uuid, friendship.created_at
  from actor
  join public.friendships friendship
    on actor.id in (friendship.user_low_id, friendship.user_high_id)
  join public.collaboration_identities identity
    on identity.owner_id = case when friendship.user_low_id = actor.id
      then friendship.user_high_id else friendship.user_low_id end
  join public.profiles profile on profile.owner_id = identity.owner_id
  union all
  select identity.public_id, profile.display_name, profile.image_url,
    'blocked', null::uuid, block.created_at
  from actor
  join public.user_blocks block on block.blocker_id = actor.id
  join public.collaboration_identities identity on identity.owner_id = block.blocked_id
  join public.profiles profile on profile.owner_id = identity.owner_id
  )
  select * from connections order by occurred_at desc;
$$;

revoke all on function public.send_friend_request(uuid) from public, anon;
revoke all on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke all on function public.cancel_friend_request(uuid) from public, anon;
revoke all on function public.unfriend_profile(uuid) from public, anon;
revoke all on function public.block_profile(uuid) from public, anon;
revoke all on function public.unblock_profile(uuid) from public, anon;
revoke all on function public.find_collaboration_profile(text) from public, anon;
revoke all on function public.list_collaboration_connections() from public, anon;

grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
grant execute on function public.unfriend_profile(uuid) to authenticated;
grant execute on function public.block_profile(uuid) to authenticated;
grant execute on function public.unblock_profile(uuid) to authenticated;
grant execute on function public.find_collaboration_profile(text) to authenticated;
grant execute on function public.list_collaboration_connections() to authenticated;

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
