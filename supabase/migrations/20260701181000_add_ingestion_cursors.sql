create table if not exists ingestion_cursors (
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

create index if not exists ingestion_cursors_updated_idx
on ingestion_cursors(updated_at desc);

alter table ingestion_cursors enable row level security;
