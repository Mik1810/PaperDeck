# Session 70

## Scope

- Align the local Next.js database runtime with Vercel Preview and Production
  after the successful Supabase Transaction-pooler rollout.
- Preserve a Session-pooler path for Drizzle Kit and maintenance commands.

## Decision

- `DATABASE_URL` is the application-runtime URL in every environment and uses
  the Supabase Transaction pooler on port 6543.
- `DATABASE_MAX_CONNECTIONS=3` is shared by local development, Preview, and
  Production so local runtime behavior covers the same pool limit.
- `DATABASE_ADMIN_URL` uses the Session pooler on port 5432 for Drizzle Kit and
  maintenance scripts.
- Administrative consumers temporarily fall back to `DATABASE_URL` so existing
  CI environments do not break before their optional administrative variable
  is configured.

## Changes

- Updated `drizzle.config.ts` and both pruning scripts to prefer
  `DATABASE_ADMIN_URL`.
- Disabled named prepared statements in direct Postgres.js test and pruning
  clients so any runtime-path test can safely use Transaction mode.
- Updated `.env.example`, deployment guidance, the authorization-boundary
  document, roadmap, and changelog with the dual-URL contract.
- Added unit coverage that locks administrative routing and the example ports.

## Safety

- Local configuration was inspected only as presence, pooler classification,
  port, and connection-limit booleans. No URL, credential, token, email, hash,
  or user identifier was printed or versioned.
- The pruning validations used `--dry-run`; no row was created, updated, or
  deleted.
- The shared Transaction-pooler gate was read-only and reported zero mutations.

## Validation

- Local configuration: runtime Transaction 6543, administration Session 5432,
  and application limit 3 all present and structurally valid.
- Recommendation-impression pruning dry-run completed with zero eligible rows.
- Notification and group-activity pruning dry-run completed with zero eligible
  rows.
- Local Transaction `/groups` gate: 60/60 completed, zero failures, zero
  mutations, p95 2.507 seconds under 12-way load.
- `npm run lint` passed.
- `npm run typecheck` passed.
- `npx drizzle-kit check` loaded the dual-URL configuration and reported the
  migration folder consistent.
- `npm run test:unit`: 121/121 passed.
- `npm run build` passed with all authenticated routes remaining dynamic.
- `npm run test:e2e:group-workspace` passed its member, owner, and mobile
  phases, with zero remote mutations and zero Clerk sessions.
