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

## Pending Production gate

- Keep the implementation unmerged until a separate Production decision.
- Production first needs the two #95 migrations and the #107 wrapper migration,
  in order, followed by privilege and disabled-flag verification before the
  webhook code can be deployed.
