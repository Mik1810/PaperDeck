# Session 84

## Issue #176: complete and benchmark catalog-search indexes

### Scope and decisions

- Preserved catalog search across title, abstract/venue full text, author,
  arXiv ID, DOI, and topic label.
- Replaced page-number `OFFSET` pagination with an opaque, query-bound,
  bidirectional keyset ordered by rank descending, year descending with nulls
  last, and paper ID ascending.
- Added only the missing arXiv-ID and DOI trigram indexes. The existing title,
  author, and full-text indexes remain appropriate.
- Did not add a topic-label index: `EXPLAIN (ANALYZE, BUFFERS)` consistently
  preferred scanning the tiny taxonomy table and then using
  `paper_topics_topic_idx`, including at 300,000 papers.
- No durable product decision changed.

### Changes

- Search candidates now come from materialized `UNION ALL` branches for paper
  fields, authors, and topics, followed by one deduplicating score aggregate.
  This lets PostgreSQL choose the relevant GIN access path rather than planning
  one broad `OR` with correlated `EXISTS` subqueries.
- Nullable DOI and arXiv fields are matched directly, so their partial trigram
  indexes match the query expressions; the old `coalesce(field, '')` wrappers
  are gone.
- Cursors carry direction, rank, nullable year, ID, target page, and a truncated
  SHA-256 query binding. Decoding rejects malformed, oversized, cross-query, or
  invalid boundaries before SQL parameterization.
- Forward and reverse boundaries preserve the exact ordering and support
  Previous/Next links without retaining an unbounded cursor chain.
- Invalid cursors on the search page safely fall back to the first page. New
  search form submissions naturally clear the cursor.
- The local schema parity gate now requires all five catalog-search indexes.

### Local benchmark

The guarded benchmark used disposable `paperdeck_test`, incremental synthetic
catalogs of 3,000, 30,000, and 300,000 papers, ten warm repository runs per
query, and JSON `EXPLAIN (ANALYZE, BUFFERS)` plans. It covered title, author,
DOI, arXiv ID, topic, and a 2,500-result deep-cursor query.

| Papers | Title p95 | Author p95 | DOI p95 | arXiv p95 | Topic p95 | Page 1 p95 | Page 100 p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3,000 | 10.31 ms | 9.13 ms | 8.49 ms | 7.80 ms | 8.82 ms | 7.11 ms | 6.99 ms |
| 30,000 | 54.93 ms | 52.85 ms | 54.20 ms | 50.29 ms | 53.32 ms | 53.60 ms | 49.93 ms |
| 300,000 | 19.98 ms | 19.86 ms | 41.07 ms | 15.67 ms | 21.13 ms | 16.41 ms | 17.02 ms |

At 3,000 and 30,000 rows PostgreSQL judged sequential scans cheaper for some
branches. At 300,000 rows the captured plans used
`papers_search_vector_gin_idx`, `papers_title_trgm_idx`,
`paper_authors_name_trgm_idx`, `papers_arxiv_id_trgm_idx`, and
`papers_doi_trgm_idx`. Page 100 remained effectively equal to page 1 because
no result rows are skipped with `OFFSET`.

### Correctness and safety

- Repository integration covers 45 tied/ranked results across three forward
  pages and one reverse page with no gaps or duplicates, including nullable
  years. It also verifies author, DOI, arXiv, and topic matches.
- Desktop and mobile browser checks verify 20-result pages, disjoint Next
  results, exact Previous restoration, cursor URLs, and absence of `page=`.
- Database preparation, benchmark rows, query plans, and browser fixtures were
  confined to disposable local PostgreSQL. Benchmark cleanup left zero
  synthetic benchmark papers and topics. No hosted data was read or mutated.

### Validation

- `npm run db:test:prepare` (baseline plus all 33 ordered migrations)
- `npm run benchmark:catalog-search` (3k/30k/300k; all plan assertions passed)
- Catalog-search integration tests (2 passed)
- Focused desktop/mobile Search E2E (6 passed)
- `npm run test:unit` (148 passed)
- `npm run typecheck`
- `npm run lint`
- `TMPDIR=/tmp npm run build`
- `git diff --check`
