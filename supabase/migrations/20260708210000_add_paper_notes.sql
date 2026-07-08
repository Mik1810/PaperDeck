create table if not exists paper_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references profiles(owner_id) on delete cascade,
  paper_id uuid not null references papers(id) on delete cascade,
  playlist_id uuid references playlists(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists paper_notes_owner_paper_created_idx
on paper_notes(owner_id, paper_id, created_at desc);

create index if not exists paper_notes_playlist_idx
on paper_notes(playlist_id);

alter table paper_notes enable row level security;

drop policy if exists "paper_notes_own" on paper_notes;

create policy "paper_notes_own"
on paper_notes for all
using (owner_id = auth.jwt() ->> 'sub')
with check (owner_id = auth.jwt() ->> 'sub');
