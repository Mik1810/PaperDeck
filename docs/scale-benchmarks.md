# Scale benchmarks

`npm run benchmark:scale` exercises the main PaperDeck data paths serially
against the canonical disposable `paperdeck_test` database. Every database
benchmark calls `assertDisposableLocalDatabase` before importing application
repositories or creating fixtures, so a hosted or non-test database is rejected.

The suite intentionally stays out of the default test command because the
300,000-paper catalog and 1,000,000-row retention scenarios are capacity checks,
not fast correctness tests. Prepare the canonical database with
`npm run db:test:prepare`, then run the complete suite or one family:

| Command | Scales | Primary evidence |
| --- | --- | --- |
| `npm run benchmark:library` | 10, 100, 1,000 papers | query/row counts, response and client-cache bytes, p50/p95 server latency |
| `npm run benchmark:group-pagination` | 10, 100, 500 papers | SQL, DB-result, HTML/RSC bytes, p50/p95 server and mobile-render latency |
| `npm run benchmark:catalog-search` | 3k, 30k, 300k papers | SQL plans/timing, query/row counts, response bytes, p50/p95 latency |
| `npm run benchmark:profile-inputs` | 10, 100, 1,000 saved papers | SQL and server timing, query/row counts, response bytes, pool occupancy/wait, p50/p95 latency |
| `npm run benchmark:recommendation-retention` | 10k, 100k, 1M expired rows | transaction p95, throughput, WAL, bounded batches, lock waits |

## Comparison policy

- Compare runs on the same machine, PostgreSQL major version, and database
  preparation. Use medians and p95 values rather than one cold sample.
- Treat a query-count, transferred-row, pagination-size, plan/index, bounded
  batch, or lock-wait assertion failure as a regression. These are deterministic
  guards embedded in the individual scripts.
- For timing-only changes, rerun the affected family once. Investigate a
  repeatable p95 increase above 25% against the relevant historical baseline;
  timings are local comparative evidence, not production SLAs.
- Store new accepted baselines in the issue session note, including the machine
  context when it materially differs. Do not silently replace older evidence.

## Historical baselines

The first complete family baselines are recorded in repository sessions:

- Library: `sessions/SESSION82.md`.
- Research groups: `sessions/SESSION83.md`.
- Catalog search: `sessions/SESSION84.md`.
- Recommendation retention: `sessions/SESSION86.md`.
- Profile inputs and the complete #187 inventory: `sessions/SESSION98.md`.

Metrics are path-specific. For example, HTTP/RSC size applies to rendered
routes, while WAL and lock waits apply to retention. A family reports the
metrics that can identify its actual egress, pool-pressure, or latency risk;
the suite does not invent an HTTP payload for a background maintenance worker.
