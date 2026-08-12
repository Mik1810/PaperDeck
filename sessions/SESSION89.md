# Session 89

## Issue #181: cached feed fast path

### Scope and decisions

- Moved the cheapest valid-cache decision ahead of taxonomy and full feed-state
  loading for both initial and live recommendation batches.
- Kept all current collection and durable-exclusion semantics by filtering
  hidden papers in the owner-scoped PostgreSQL lookup rather than transferring
  the complete state to the application.
- Split Favorite and `Read later` presentation flags from ranking state so a
  page cache hit loads only the UI state it renders; ranking-only consumers do
  not pay for it.
- Reused the existing composite recommendation index and owner/paper keys. No
  schema or hosted Supabase change was necessary.

### Changes

- A fresh batch is selected with one statement using the latest generation and
  `not exists` filters for Favorites, any private playlist, and durable feed
  exclusions.
- Cached paper records are hydrated only after at least ten eligible rows have
  been found; an undersized initial batch falls through to the live batch, then
  to taxonomy, complete ranking state, semantic retrieval, and live ranking.
- Added a guarded disposable-database benchmark, focused pipeline regressions,
  and a desktop/mobile browser regression covering all three cached exclusion
  sources plus reversible playlist removal.

### Local benchmark

`npm run benchmark:feed-cache` instruments the ranked-feed retrieval core on
the disposable local `paperdeck_test` database. It performs two warmups and 20
measured runs per scenario.

| Scenario | Queries p50 | DB rows p50 | Response | p50 | p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cold live rank | 13 | 216 | 43,924 B | 8.18 ms | 10.19 ms |
| Fresh cache hit | 4 | 200 | 39,997 B | 3.40 ms | 3.82 ms |

The benchmark compares the shared ranked-feed retrieval core, before the feed
page's delivery write and presentation-state read. It fails if a cache hit does
not reduce both query count and transferred rows.

### Safety

- All new reads remain server-side and owner-scoped; identifiers and secrets
  are not logged.
- Benchmark fixtures and browser validation use only guarded local
  `paperdeck_test`; no shared Supabase data or configuration is modified.

### Validation

- `npm run benchmark:feed-cache`
- `npm run test:unit` (149 passed)
- Full `tests/e2e/feed-exclusions.spec.ts` (3 passed, 1 intentional skip)
- Full `tests/e2e/mutations.spec.ts` (34 passed across desktop/mobile)
- `npm run typecheck`
- `npm run lint`
- `TMPDIR=/tmp npm run build`
- `git diff --check`
