-- Complete the trigram access paths used by catalog search. Nullable paper
-- identifiers are indexed directly, matching the query rather than a
-- coalesce wrapper. Topic matching starts from the small taxonomy table before
-- joining its paper IDs; benchmarks show a label index is not justified.

create index papers_arxiv_id_trgm_idx
  on public.papers using gin (arxiv_id gin_trgm_ops)
  where arxiv_id is not null;

create index papers_doi_trgm_idx
  on public.papers using gin (doi gin_trgm_ops)
  where doi is not null;
