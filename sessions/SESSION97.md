# Session 97

## Issue #184: runtime query deadlines and pool diagnostics

### Scope and decision

- Moved the application-only `pg.Pool` construction into a runtime pool factory;
  Drizzle Kit, ingestion, and maintenance scripts retain their separate
  administrative connection policy.
- Added a 15-second PostgreSQL `statement_timeout` and a slightly longer
  18-second node-postgres `query_timeout` fail-safe. The fail-safe bounds the
  runtime even if a proxy does not propagate the server setting and is forced
  to remain at least one second above the statement deadline.
- Added structured warnings for one-second queries, timeout cancellations, and
  pool waits above 100ms or observed saturation. Diagnostics contain an
  application source frame, duration/wait, outcome, and total/idle/waiting pool
  counts; they do not contain SQL, database URLs, or owner identifiers.
- Exposed server-only environment overrides for the deadlines and diagnostic
  thresholds while retaining safe defaults. The hosted three-connection guard
  remains unchanged.

### Regression evidence

- Rebuilt the guarded loopback `paperdeck_test` database from the baseline plus
  all 35 ordered migrations and loaded the synthetic fixture.
- With a one-connection application pool, ran `pg_sleep(0.5)` under a 100ms
  statement deadline and queued `select 1` behind it. PostgreSQL cancelled the
  slow statement with SQLSTATE `57014`; the queued statement then succeeded.
- The regression also asserted a structured `database_query_timeout` event and
  a saturated `database_pool_acquire` event with a measured wait and occupancy
  fields. No hosted database was contacted or mutated.

### Validation

- Focused database-client/runtime-pool unit tests: 3 passed.
- Runtime-pool PostgreSQL integration regression: 1 passed.
- Focused ESLint passed.
- TypeScript typecheck passed.
- `scripts/pd-final-check` passed diff check, typecheck, full lint, and all unit
  tests.
