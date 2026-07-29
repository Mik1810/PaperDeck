# Session 52

## Atomic Clerk deletion lifecycle (#107)

- Chose one PostgreSQL RPC instead of two sequential Data API calls or a new
  direct-connection transaction in the webhook.
- Added `handle_clerk_user_deleted(owner_id)` as a `SECURITY INVOKER`,
  service-role-only wrapper around deterministic research-group account
  closure and collaboration identity deletion.
- Kept signature verification before service-role client creation.
- Changed only the verified `user.deleted` branch; `user.created` and
  `user.updated` retain their existing identity synchronization behavior.
- Return a generic retryable `500` on RPC and transport failures without
  logging webhook payloads or identifiers.
- Added a pinned direct test dependency on `standardwebhooks@1.0.0`, already
  transitively used by Clerk, to generate authentic signatures from a random
  in-memory test secret.
- Kept Clerk users, sessions, credentials, and Production untouched.

## Local validation

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit` — 93 passed
- Signed synthetic `user.deleted` verification and tamper rejection — passed
- Isolated PostgreSQL 17 lifecycle suite — 6 passed:
  - selected succession plus unrelated membership removal;
  - oldest-admin and oldest-member fallback precedence;
  - owner-only group deletion;
  - idempotent duplicate delivery;
  - concurrent duplicate serialization;
  - service-role-only execution;
  - rollback of succession when identity deletion fails.
- `supabase db lint` connected to the isolated cluster but could not run because
  vanilla PostgreSQL did not include Supabase's required `plpgsql_check`
  extension. Migration parsing/execution and runtime tests passed.
- The isolated cluster lived under `/tmp`, was stopped after the run, and was
  moved to the desktop trash. It used no Supabase or Clerk credential.

## Development validation

- Applied only
  `20260729114003_wire_clerk_user_deletion_lifecycle.sql` to Supabase
  Development after confirming both #95 migrations were already present.
- Verified the wrapper is `SECURITY INVOKER`, has a fixed search path, denies
  execution to `PUBLIC`, `anon`, and `authenticated`, and grants execution only
  to `service_role`.
- Ran `npm run test:integration:clerk-deletion` against Development with a
  random signing secret held only in memory. The signed synthetic lifecycle
  test passed, including selected/admin/member succession, owner-only deletion,
  unrelated membership removal, and duplicate delivery.
- The first harness form imported the complete Next.js Route Handler and hit a
  React runtime mismatch before any RPC call. It was replaced with a
  component-level live test of the real Clerk verifier and the real deletion
  helper; the unit suite continues to enforce Route Handler wiring.
- Independently verified zero synthetic profiles, identities, groups, and
  memberships after cleanup. Both research-group switches remained disabled.
- Ran Supabase security and performance advisors. They reported no new
  #107-specific finding; existing project-wide findings remain separate work.
- No real Clerk user, webhook credential, session, email, or token was created,
  deleted, revoked, persisted, or logged.
- Final repository checks passed: typecheck, lint, 93 unit tests, 6 isolated
  PostgreSQL lifecycle tests, service-role audit, production build, and
  `git diff --check`.
- Updated GitHub issue #107 with the Development evidence and left it open for
  the separate Production approval gate.

## Shared database Production preflight

- Supabase account discovery found one PaperDeck project, the same project used
  for the Development validation and recorded during credential recovery as the
  Vercel Production pooler target.
- The shared database contains existing application profiles and collaboration
  identities, confirming it is not an isolated disposable Development store.
- All three #95/#107 migrations were already registered, so no migration was
  re-applied and no DDL or application data was changed during this preflight.
- Verified zero research groups and memberships, disabled read/write switches,
  RLS on both group tables, `SECURITY INVOKER`, a fixed search path, and
  `service_role`-only execution for the Clerk deletion wrapper.
- Re-ran Supabase security and performance advisors. No #107-specific finding
  was reported; existing project-wide findings remain separate work.
- The local Vercel CLI was unavailable, so the current Production environment
  value could not be re-read live. Repository recovery evidence and the
  single-project Supabase topology support the shared-database conclusion
  without exposing any environment value.

## Production application gate

- Marked PR #108 ready and squash-merged it to `main` after explicit approval.
  The App CI check was still pending and was not awaited; the Vercel Preview
  checks had passed.
- The automatic Vercel Production deployment for merge commit `43e99e4`
  reached `READY`.
- A single unsigned `POST /api/webhooks/clerk` returned `400` before any
  service-role client creation or data access.
- Vercel reported no webhook-specific or project-wide runtime errors in the
  post-deploy 30-minute window. The only observed request status on the new
  deployment was the expected unsigned-smoke `400`.
- No signed event, Clerk user, session, group, membership, collaboration
  identity, or other application data was created, deleted, or modified during
  the Production application verification.
