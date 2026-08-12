# Session 90

## Issue #182: single-query digest widening

### Scope and decisions

- Preserved the existing digest contract: choose the first 7-, 14-, or 30-day
  window containing at least three ranked papers; when even 30 days is sparse,
  return every eligible paper from that maximum window.
- Replaced overlapping recency reads with one maximum-window query returning
  only paper IDs and their effective `published_at`/`ingested_at` timestamp.
- Kept ranking order, feed exclusions, ten-paper cap, topic grouping, and
  `Read later` presentation state unchanged.
- No fallback query is needed because the maximum-window result contains every
  field required for in-memory partitioning. No schema or hosted Supabase
  change is required.

### Query-count regression

The previous loop queried each overlapping window until it found enough
papers. The new selector always invokes its maximum-window loader once:

| Selected window | Previous recency queries | Current recency queries |
| --- | ---: | ---: |
| 7 days | 1 | 1 |
| 14 days | 2 | 1 |
| 30 days or undersized | 3 | 1 |

Unit regressions instrument the loader call and verify dense, 14-day, 30-day,
and undersized catalogs. Browser regressions seed fresh cached batches in the
disposable local database and verify the exact rendered paper membership for
dense and sparse digests.

### Safety

- The recency query remains server-side and reads only the already-ranked paper
  IDs; no owner data, identifiers, credentials, or remote configuration are
  logged.
- Browser fixtures run only against guarded local `paperdeck_test` and restore
  every modified catalog timestamp after each test.

### Validation

- `npm run test:unit` (150 passed, including 4 digest-selection regressions)
- `tests/e2e/digest-recency.spec.ts` (2 passed, 2 intentional mobile skips)
- `npm run typecheck`
- `npm run lint`
- `TMPDIR=/tmp npm run build`
- `git diff --check`
