create table if not exists recommendation_batch_items (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references profiles(owner_id) on delete cascade,
  paper_id uuid not null references papers(id) on delete cascade,
  batch_id uuid not null,
  rank integer not null check (rank > 0),
  score real not null,
  score_components jsonb not null default '{}'::jsonb,
  model_version text not null,
  delivered_at timestamptz not null default now(),
  unique (owner_id, paper_id, batch_id)
);

create index if not exists recommendation_batch_items_owner_delivered_idx
on recommendation_batch_items(owner_id, delivered_at desc);

create index if not exists recommendation_batch_items_owner_batch_rank_idx
on recommendation_batch_items(owner_id, batch_id, rank);

alter table recommendation_batch_items enable row level security;

drop policy if exists "recommendation_batch_items_own"
on recommendation_batch_items;

create policy "recommendation_batch_items_own"
on recommendation_batch_items for all
using (owner_id = auth.jwt() ->> 'sub')
with check (owner_id = auth.jwt() ->> 'sub');

alter table recommendation_impressions
  add column if not exists batch_item_id uuid
  references recommendation_batch_items(id) on delete cascade;

insert into recommendation_batch_items (
  owner_id,
  paper_id,
  batch_id,
  rank,
  score,
  score_components,
  model_version,
  delivered_at
)
select
  owner_id,
  paper_id,
  batch_id,
  rank,
  score,
  score_components,
  model_version,
  shown_at
from recommendation_impressions
on conflict (owner_id, paper_id, batch_id) do nothing;

update recommendation_impressions as impression
set batch_item_id = batch_item.id
from recommendation_batch_items as batch_item
where impression.batch_item_id is null
  and batch_item.owner_id = impression.owner_id
  and batch_item.paper_id = impression.paper_id
  and batch_item.batch_id = impression.batch_id;

alter table recommendation_impressions
  alter column batch_item_id set not null;

create unique index if not exists recommendation_impressions_batch_item_unique_idx
on recommendation_impressions(batch_item_id);
