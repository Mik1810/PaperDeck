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

create table profiles (
  owner_id text primary key,
  display_name text,
  image_url text,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
