-- Add pg_trgm extension and full-text search indexes for fast catalog search.
-- Replaces the previous unindexed ILIKE scan over 7 columns with tsvector
-- ranking (primary) and trigram-indexed fuzzy matching (secondary).

create extension if not exists pg_trgm;

-- ------------------------------------------------------------------
-- Generated tsvector column with weighted fields
-- Weight A: title (highest priority)
-- Weight B: abstract
-- Weight C: venue
-- ------------------------------------------------------------------
alter table papers
  add column if not exists search_vector tsvector
    generated always as (
      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(abstract, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(venue, '')), 'C')
    ) stored;

-- GIN index for fast tsquery match
create index if not exists papers_search_vector_gin_idx
  on papers using gin (search_vector);

-- ------------------------------------------------------------------
-- Trigram indexes for fast ILIKE fuzzy matching
-- Used as secondary filter for author names, arxiv_id, doi,
-- and topic labels where tsvector is less effective.
-- ------------------------------------------------------------------
create index if not exists papers_title_trgm_idx
  on papers using gin (title gin_trgm_ops);

create index if not exists paper_authors_name_trgm_idx
  on paper_authors using gin (name gin_trgm_ops);

