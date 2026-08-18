# Session 98

## Issue #187: scale benchmarks for main data paths

### Scope and decisions

- Inventoried the issue matrix against the repository's existing guarded
  benchmarks. Library, research-group, catalog-search, and expired-impression
  scales already had current implementations and historical baselines.
- Added the missing 10/100/1,000-saved-paper profile-input benchmark against the
  real profile-embedding refresh repository.
- Added one serial `benchmark:scale` command and a durable guide defining the
  matrix, metric applicability, deterministic guards, and a 25% repeatable p95
  investigation threshold for timing-only changes.
- No production query, schema, hosted data, or roadmap decision changed.

### Profile-input baseline

The benchmark used the canonical disposable `paperdeck_test` database, two
warmups, and 20 measured up-to-date refreshes per scale. It instrumented the
node-postgres runtime pool and reports query wall time as SQL timing; parallel
query timings may sum above end-to-end server time.

| Saved papers | Queries p50 | DB rows p50 | Response | SQL p50 | SQL p95 | Server p50 | Server p95 | Acquire p95 | Pool active/waiting max |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 9 | 24 | 40 B | 5.57 ms | 6.02 ms | 4.87 ms | 5.32 ms | 0.20 ms | 3 / 3 |
| 100 | 9 | 204 | 41 B | 5.51 ms | 6.37 ms | 5.99 ms | 6.76 ms | 0.19 ms | 3 / 3 |
| 1,000 | 9 | 2,004 | 42 B | 10.76 ms | 12.08 ms | 23.12 ms | 29.98 ms | 0.18 ms | 3 / 3 |

Query count remains flat. Row transfer and vector aggregation scale with the
actual saved-paper input, while the four independent input reads visibly use
the configured three-connection pool and queue acquisitions.

### Complete-suite evidence

- Library passed at 10/100/1,000 papers with 7 queries and a bounded 24-paper
  first page for the larger scales.
- Research groups passed at 10/100/500 papers with one initial query and a
  bounded 40-paper first page; the 100/500 HTML and RSC payloads were identical.
- Catalog search passed at 3k/30k/300k papers, including all required index-plan
  assertions and effectively flat page-1/page-100 keyset timings.
- Profile inputs passed at 10/100/1,000 saved papers with the baseline above.
- The first serial run exposed that retention alone did not load `.env.local`
  and tried the stale fallback port. After matching the other benchmark entry
  points with `loadEnvConfig`, the 10k/100k/1M retention run passed against the
  current Docker-published endpoint. The million-row run used 101 transactions
  per table, observed zero lock-wait time, and preserved 100,000 fresh rows.

### Safety and validation

- `npm run db:test:prepare` (baseline plus all 35 ordered migrations)
- `npm run benchmark:profile-inputs` (twice; stable 10/100/1,000 matrix)
- `npm run benchmark:scale` (first four families passed; found the retention
  environment-loading defect before retention fixtures were created)
- `npm run benchmark:recommendation-retention` after the endpoint fix (10k,
  100k, and 1M passed)
- `npm run typecheck`
- `npm run lint`

Every fixture and destructive capacity operation was guarded to local
`paperdeck_test`. No hosted Supabase data, credentials, or configuration was
read or modified.
