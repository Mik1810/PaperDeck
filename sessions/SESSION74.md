# Session 74

## Scope

- Audit the completed Supabase Transaction-pooler rollout across local,
  Preview, and Production environments.
- Remove obsolete merged branches and prevent hosted database configuration
  from silently regressing.

## Findings

- Preview and Production already contain encrypted `DATABASE_URL` and
  `DATABASE_MAX_CONNECTIONS` variables and were previously deployed through
  the Transaction pooler rollout.
- Local development correctly resolves `DATABASE_URL` to the isolated Docker
  database on port 55432; `DATABASE_ADMIN_URL` remains the Session-pooler source
  used only for catalog refresh and maintenance.
- The local Docker snapshot is healthy with 3,261 catalog papers and zero
  copied profiles.
- Deployment documentation still described local development as a Supavisor
  Transaction client, contradicting the later local-isolation decision.
- No executable guard prevented a future Vercel environment edit from changing
  the runtime back to Session mode or a one-connection application pool.

## Changes

- Added a pure hosted-runtime validator that requires Vercel Preview and
  Production to use the Supabase shared pooler on port 6543 with
  `DATABASE_MAX_CONNECTIONS=3`.
- Applied the validator before database-pool creation and before hosted builds.
- Added unit coverage for valid Transaction mode, isolated local databases,
  Session-mode rejection, unrelated-host rejection, and one-connection pool
  rejection. Error messages never include the configured URL.
- Corrected the deployment guide and roadmap to distinguish hosted Supavisor
  traffic from isolated local and CI PostgreSQL.
- Removed six obsolete local and remote `codex/*` branches after confirming
  their pull requests were merged. New work uses `transaction-pooler-audit`
  without the old prefix.

## Safety

- No Supabase row, schema, user, session, pool setting, or Vercel environment
  variable was created, updated, or deleted.
- Environment audits reported only presence, host classification, ports, pool
  limits, and aggregate local row counts. Temporary Vercel env files were
  permission-restricted and securely deleted immediately after classification.
- Existing unrelated changes in `TASKS.md` and the untracked audit document
  were preserved and excluded from this work.

## Validation

- Local database: healthy, 3,261 papers, zero profiles.
- Hosted configuration gate: accepted synthetic Transaction mode and rejected
  synthetic Session mode without exposing its URL.
- `npm run test:unit`: 132/132 passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed against the isolated local database.
