# Session 109

## Issue #224: durable enrichment outcomes

### Scope and decisions

- Replaced missing-positive-ID queue semantics with one durable outcome per
  provider/paper for Semantic Scholar, OpenAlex, and Unpaywall.
- Kept the workers outside Vercel and retained their existing positive metadata
  writes and cursor keys.
- Classified `found`, `not_found`, and `not_oa` as terminal. Retryable provider,
  network, and response-validation failures use exponential backoff from one
  hour to a 24-hour cap.
- Kept `ingestion_cursors.imported_count` as the cumulative positive count while
  updating each cursor through terminal misses and retryable attempts so its
  paper ID represents the most recently processed candidate.

### Changes

- Added `paper_enrichment_outcomes`, a service-role-only RLS table with provider,
  paper, outcome, attempt count, last check, and next retry state.
- The migration backfills existing Semantic Scholar/OpenAlex identifiers and
  Unpaywall OA rows as `found` without re-requesting them.
- Added shared bounded-page selection, persistence, backoff, and batch-processing
  helpers used by all three workers.
- Candidate scans use a descending `(ingested_at, id)` keyset backed by
  provider-specific partial indexes; the outcome FK and retry lookup also have
  dedicated indexes.
- Worker summaries now expose paper lookups, HTTP requests, terminal outcomes,
  retryable failures, and lookups per terminal outcome without claiming an
  unmeasured percentage improvement.

### Safety

- The new table enables RLS, grants no end-user policy, revokes access from
  `public`, `anon`, and `authenticated`, and grants only the worker
  `service_role` the required table operations.
- No RPC, `SECURITY DEFINER` function, hosted database, provider API, credential,
  or user-owned row was changed during implementation and validation.
- All database-writing validation ran through `scripts/pd-db-run` against the
  canonical disposable `paperdeck_test` database.

### Validation

- Nine focused fake-provider/unit checks for all three providers, including a
  permanent-miss prefix larger than the run limit, positive results, non-OA,
  retryable failures, and exact retry timing.
- Baseline plus 38 ordered migrations prepared successfully on `paperdeck_test`.
- Focused disposable-PostgreSQL integration tests for scan eligibility,
  constraints, cascade cleanup, RLS/grants, and positive-outcome backfill.
- TypeScript typecheck and ESLint passed during implementation.
- `npx drizzle-kit check` was unavailable because this repository has no
  `src/db/migrations/meta/_journal.json`; baseline-plus-migrations reconstruction
  and the focused PostgreSQL integration checks provide the schema evidence.
