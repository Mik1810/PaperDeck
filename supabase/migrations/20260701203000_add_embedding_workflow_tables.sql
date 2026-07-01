alter table papers
add column if not exists embedding_content_hash text;

create index if not exists papers_embedding_content_hash_idx
on papers(embedding_content_hash)
where embedding_content_hash is not null;

create table if not exists topic_embeddings (
  topic_id uuid not null references taxonomy_topics(id) on delete cascade,
  embedding vector(384) not null,
  embedding_model text not null,
  embedding_dimension integer not null,
  embedding_content_hash text not null,
  embedded_at timestamptz not null default now(),
  primary key (topic_id, embedding_model)
);

create table if not exists user_profile_embeddings (
  owner_id text not null references profiles(owner_id) on delete cascade,
  embedding vector(384) not null,
  embedding_model text not null,
  embedding_dimension integer not null,
  input_signature text not null,
  generated_at timestamptz not null default now(),
  primary key (owner_id, embedding_model)
);

create index if not exists topic_embeddings_model_idx
on topic_embeddings(embedding_model);

create index if not exists user_profile_embeddings_generated_idx
on user_profile_embeddings(owner_id, generated_at desc);

alter table topic_embeddings enable row level security;
alter table user_profile_embeddings enable row level security;

create policy "topic_embeddings_read_authenticated"
on topic_embeddings for select
using (auth.jwt() ->> 'sub' is not null);

create policy "user_profile_embeddings_own"
on user_profile_embeddings for all
using (owner_id = auth.jwt() ->> 'sub')
with check (owner_id = auth.jwt() ->> 'sub');
