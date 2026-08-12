# Session 87

## Issue #179: transactional and lower-round-trip arXiv ingestion

### Scope and decisions

- Replaced the per-paper Data API write chain with one service-role-only,
  security-invoker PostgreSQL function. One function invocation and transaction
  owns the paper row, versioned arXiv ID, ordered authors, and category topics.
- Retry scope is the complete paper RPC and only transient database/network
  failures are retried. Validation and other permanent errors fail immediately.
- Kept arXiv access serialized behind one shared minimum-three-second gate,
  including HTTP retries. Database persistence has a separate bounded worker
  pool, defaulting to four and capped at sixteen.
- Added a separate per-category revision sweep sorted by arXiv `updated`, with a
  timestamp plus arXiv-ID checkpoint. Publication and revision cursors do not
  overwrite one another.

### Atomicity and regression evidence

- A disposable local-database trigger injected a failure on author insertion,
  after the RPC had updated the paper and deleted existing authors. The entire
  call rolled back: paper fields, external IDs, authors, and topics matched the
  pre-call state exactly.
- Retrying the same successful bundle returned the same paper ID and state.
- A paper published in 2020 but updated in 2026 refreshed title, abstract,
  authors, categories, and versioned external ID while retaining its paper ID.
  Derived embedding and triage summary fields were invalidated when source text
  changed.
- Integration checks confirmed both new RPCs are executable by `service_role`
  and not by `anon` or `authenticated`.

### Local benchmark

The guarded benchmark used only disposable `paperdeck_test`, 250 synthetic
papers per scenario, and the same atomic RPC as production.

| Scenario | App RPCs | Max active | Duration | p50 RPC | p95 RPC |
| --- | ---: | ---: | ---: | ---: | ---: |
| Sequential | 250 | 1 | 309.9 ms | 1.19 ms | 1.53 ms |
| Bounded concurrent | 250 | 4 | 94.4 ms | 1.27 ms | 1.70 ms |

The bounded pool was 3.28 times faster locally. The old source shape required
about seven application-to-database requests per paper (about 1,750 for 250),
whereas the new path makes exactly one RPC per paper.

### Documentation and operations

- The daily/manual workflow exposes revision sweep control, uses repository
  variables for revision-page and database-concurrency bounds, and reports new,
  revision, and backfill paths separately.
- Ingestion documentation and the roadmap now record atomic persistence,
  independent request/database pacing, and revision checkpoint semantics.
- The official arXiv API manual confirms `lastUpdatedDate`, descending sort,
  paging, 2,000-result page maximum, and the three-second delay guidance.

### Validation

- Local schema preparation with all 33 ordered migrations
- Focused atomic-ingestion unit tests (7 passed)
- Focused local database integration tests (4 passed)
- `npm run benchmark:arxiv-ingestion`
- Focused ESLint
- `npm run typecheck`
- `git diff --check`
- Supabase CLI lint was attempted against the disposable local database; the
  schema lacks the optional `plpgsql_check` extension, so the CLI could not run
  its function analyzer. Direct migration execution and the function-level
  integration regressions passed.

### Safety

- No production or shared Supabase data was read or modified.
- Benchmark and integration fixtures were guarded to loopback
  `paperdeck_test` and cleaned after execution.
- The service-role key remains server-side; no secret values were printed.
