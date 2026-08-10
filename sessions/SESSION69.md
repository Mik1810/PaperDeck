# Session 69

## Scope

- Complete the research-group loading stabilization and prepare a guarded
  migration of Vercel from the Supabase Session pooler to the Transaction
  pooler.
- Keep local development unchanged unless the developer explicitly opts into a
  different connection string.

## Decision

- Keep local `.env.local` on the Session pooler at port 5432 with the existing
  one-connection default; no local environment change is required.
- Use the Transaction pooler at port 6543 for Vercel Preview and Production,
  with `DATABASE_MAX_CONNECTIONS=3`, only after a concurrent read-only gate
  passes.
- Replace the application runtime's Postgres.js adapter with node-postgres.
  Drizzle's node-postgres adapter does not name prepared statements and the
  pool queues work beyond its connection limit instead of pipelining it over an
  occupied connection.
- Retain Postgres.js only in isolated scripts and database test harnesses where
  queries are explicitly sequenced or connections are disposable.

## Investigation

- The initial Transaction probe reproduced the Production symptom with plain
  `select 1`: under 12-way concurrency, only the first query on each
  Postgres.js connection completed and later pipelined queries reached the
  deadline.
- `max_pipeline=1` still allowed a second in-flight query in Postgres.js 3.4.9
  and did not resolve the stall.
- `max_pipeline=0` made the read-only gate pass but violated an internal queue
  assumption and caused an unhandled client error during the local Server
  Action E2E. That unsupported configuration was discarded.
- The node-postgres runtime completed 36/36 concurrent raw queries and 60/60
  real `/groups` index loads through the shared Transaction pooler, with zero
  remote mutations and no identifiers in the report.

## Changes

- Switched `src/db/index.ts` to Drizzle's node-postgres adapter and a bounded
  global `pg.Pool` with five-second idle and ten-second connection timeouts.
- Adapted raw `db.execute` consumers to the node-postgres `result.rows` shape.
- Added `npm run test:pooler:transaction`, a fail-fast, read-only concurrency
  probe that derives the Transaction endpoint without displaying credentials.
- Added a unit regression for the bounded runtime client and updated deployment
  and authorization-boundary documentation.

## Safety

- The shared Transaction-pooler probes performed reads only; research-group
  writes remained disabled and the reports contained no database, Clerk, or
  user identifiers.
- No Clerk session was created and no Production user or application row was
  created, changed, or deleted.
- The browser write test used only its disposable local PostgreSQL cluster and
  synthetic identities.

## Validation Before Rollout

- Raw Transaction concurrency gate: 36/36 completed, zero failures.
- `/groups` Transaction concurrency gate: 60/60 completed, zero failures,
  p95 1.824 seconds under 12-way load.
- `npm run lint` passed.
- `npm run typecheck` passed.
- `npm run test:unit`: 119/119 passed before the driver migration; a final full
  run follows after documentation.
- `npm run build` passed before the driver migration; a final build follows.
- `npm run test:e2e:group-workspace` passed all member, owner, and mobile phases
  after the driver migration, with zero remote mutations and zero Clerk
  sessions.

## Rollout

- Preview and Production promotion evidence will be appended after each gate;
  the existing Production Session-pooler deployment remains the rollback
  target until verification completes.
