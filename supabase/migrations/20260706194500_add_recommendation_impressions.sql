create table if not exists recommendation_impressions (
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

alter table user_paper_interactions
  add column if not exists recommendation_impression_id uuid
  references recommendation_impressions(id) on delete set null;

create index if not exists user_paper_interactions_recommendation_impression_idx
on user_paper_interactions(recommendation_impression_id);

create index if not exists recommendation_impressions_owner_shown_idx
on recommendation_impressions(owner_id, shown_at desc);

create index if not exists recommendation_impressions_owner_batch_rank_idx
on recommendation_impressions(owner_id, batch_id, rank);

alter table recommendation_impressions enable row level security;

drop policy if exists "recommendation_impressions_own" on recommendation_impressions;

create policy "recommendation_impressions_own"
on recommendation_impressions for all
using (owner_id = auth.jwt() ->> 'sub')
with check (owner_id = auth.jwt() ->> 'sub');
