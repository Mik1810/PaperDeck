# Session 86

## Issue #178: batched recommendation-impression retention

### Scope and decisions

- Replaced the single transaction that deleted every expired impression and
  returned every deleted ID with bounded, independently committed statements.
- Used ordered B-tree keysets for both recommendation impressions and their
  now-separate delivered batch items. `FOR UPDATE SKIP LOCKED` prevents a busy
  row from blocking the maintenance worker.
- Kept the existing configurable retention cutoff and dry-run behavior.
- Defaulted to 10,000 rows and at most 100 batches per table, matching the
  measured million-row workload while preserving an explicit runtime bound.
- No roadmap decision changed.

### Changes

- Added `(shown_at, id)` and `(delivered_at, id)` indexes through an ordered
  Supabase migration and matching Drizzle declarations.
- The pruning library uses PostgreSQL command counts after `DELETE ... USING`;
  it has no `RETURNING` clause and no transaction spanning multiple batches.
- The CLI reports deleted counts, committed batch counts, maximum transaction
  duration, and whether work remains after the configured cap or a skipped
  lock.
- Write mode limits lock acquisition to five seconds and each statement to 30
  seconds so table-level contention or a regressed plan fails loudly instead of
  monopolizing the administrative connection.
- The scheduled/manual GitHub workflow exposes batch size and maximum-batch
  controls and includes them in its run summary.
- Added unit and disposable-PostgreSQL integration coverage plus a guarded
  benchmark command for 10k, 100k, and 1M expired rows.

### Correctness and concurrency evidence

- With one expired impression locked from a second connection, pruning deleted
  other rows without waiting, reported the remaining work, and completed it on
  a subsequent pass after the lock was released.
- Every observed mutation statement respected the configured row limit. A
  separate one-batch cap deleted exactly two rows per table, reported
  truncation, and left exactly one eligible row for the next run.
- Fresh impressions and delivered batch items were preserved. Deleting an
  expired impression retained the linked interaction while setting its foreign
  key to null, as required by the existing schema.

### Local performance benchmark

The benchmark used disposable PostgreSQL 17 `paperdeck_test`, a 10,000-row
batch, one deliberately locked expired row, and 10% fresh rows (minimum 1,000).
WAL covers both the impression and batch-item deletes. Lock waits were sampled
every 25 ms from `pg_stat_activity` while the worker ran.

| Expired rows per table | Committed delete tx | Total prune | Rows/s | p95 tx | Max tx | WAL bytes | Observed lock wait |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | 4 | 93.82 ms | 213,168 | 47.18 ms | 47.18 ms | 2,315,888 | 0 ms |
| 100,000 | 22 | 1,444.15 ms | 138,490 | 99.33 ms | 104.69 ms | 23,165,536 | 0 ms |
| 1,000,000 | 202 | 132,236.24 ms | 15,124 | 1,010.92 ms | 1,094.65 ms | 1,054,096,944 | 0 ms |

The intentional lock adds one resume transaction per table. After each large
delete, `VACUUM (ANALYZE)` reduced estimated dead tuples to zero while exact
queries verified zero expired rows and all fresh rows remained.

### B-tree versus BRIN

On 1.1 million physically time-correlated rows, the `(shown_at, id)` B-tree was
44,695,552 bytes and returned the ordered 10,000-row candidate page in 6.249 ms.
A BRIN on `shown_at` was only 24,576 bytes, but PostgreSQL chose a parallel
sequential scan plus sort because BRIN cannot supply the required two-column
order; the same page took 57.741 ms. The B-tree is retained for predictable
bounded-delete latency, while BRIN is not added as redundant write overhead.

### Safety

- Fixtures and destructive benchmarks were restricted by
  `assertDisposableLocalDatabase` to local `paperdeck_test`.
- No shared Supabase data, hosted configuration, secret, email, or personal
  identifier was read or modified.
- Internal retention SQL remains accessible only through the administrative
  direct connection; no new Data API surface or privileged function was added.
- Supabase CLI advisors reported only the two pre-existing `auth.jwt()`
  initialization-plan warnings on these tables' owner RLS policies. The
  administrative maintenance path bypasses those policies, and this issue does
  not change their authorization behavior.

### Validation

- `npm run db:test:prepare` (baseline plus all 33 ordered migrations)
- Focused retention unit tests (3 passed)
- Focused retention integration tests (2 passed)
- `npm run benchmark:recommendation-retention` (10k, 100k, 1M)
- `npm run benchmark:recommendation-retention -- --scale=1000000`
- Supabase CLI security/performance advisors against local `paperdeck_test`
- `analytics:prune` local dry-run and zero-row write-mode smoke
- `npm run test:unit` (149 passed)
- `npm run typecheck`
- `npm run lint`
- `npx drizzle-kit check`
- Workflow YAML parse
- `TMPDIR=/tmp npm run build`
- `git diff --check`
