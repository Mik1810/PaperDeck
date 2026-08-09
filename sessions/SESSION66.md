# Session 66

## Issue #99: shared research-group paper foundation

- Confirmed the product contract before implementation: a group exists
  independently and may be empty; it has one chronological paper list with no
  stored position, manual reorder, or list revision.
- Defined removal authority as owner/admin for any paper and member only for
  their own additions. Saving a shared paper privately remains an explicit
  personal action and group activity cannot influence personal ranking.
- Added incremental migrations and the standalone schema for shared items,
  detached contributor provenance, minimal 90-day activity, notification
  preferences, read-only membership RLS, service-role-only transactional
  operations, a 500-current-item cap, and bounded retention.
- Addition notifications aggregate per actor and group in ten-minute buckets;
  removals are individual important events. Source rows remain authoritative,
  and no rendered message, email, token, or personal signal is stored.
- Added server-only repositories and notification presentation support without
  exposing Clerk IDs. A removed account leaves its shared paper in a surviving
  group with a generic `Former member` contributor.
- Extended the existing notification retention worker to report and purge
  expired group-paper activity in bounded batches.
- Added a disposable native PostgreSQL 17 test harness. It validates concurrent
  idempotency, aggregation/preferences, role moderation, outsider/revoked RLS,
  account-closure anonymization, kill switches, grants/function security, and
  retention cascade while proving zero writes to private library/ranking data.
- Added the minimum responsive group workspace. `/groups` shows active groups,
  incoming invitations, empty state, and group creation; `/groups/[groupId]`
  shows chronological papers, explicit private saving, role-aware removal,
  notification preference, exact-email invitation, member roles/removal, and
  leave/delete controls.
- Added `Research groups` to Clerk's existing account menu without adding a
  desktop or mobile navbar item. Local dev-auth uses its existing badge as the
  non-product test entry point.
- Added an authenticated private/no-store catalog-search Route Handler for the
  add-paper dialog. Every mutation authenticates inside its Server Action and
  delegates authorization to the transactional repository/database checks.
- Added `npm run test:e2e:group-workspace`, a repeatable WSL browser gate backed
  by a native PostgreSQL cluster under `/tmp`. It uses three synthetic local
  identities, the real standalone schema plus the catalog-search migration,
  enables group switches only inside the temporary database, and always stops
  the local servers and deletes the cluster through a shell trap.
- The gate covers member preference/leave permissions; owner create/delete,
  search, add/remove, role changes, and explicit `Save privately`; database
  assertions prove that a group add does not write personal interactions,
  favorites, recommendations, or playlists, while the explicit private save
  creates exactly its intended playlist row and `group`-context interaction.
- Mobile Chromium verifies meaningful group content, no Next.js error overlay,
  and no horizontal overflow. Exact-email invitation execution remains outside
  the local gate because it intentionally requires a Clerk-authenticated
  Supabase client.
- The local setup exposed a maintenance gap: `supabase/schema.sql` does not
  include the generated catalog `search_vector`; the gate therefore applies the
  existing `20260714210105_add_search_indexes.sql` migration explicitly.
- A read-only shared-database preflight found two migration-history versions
  whose SQL matched local files exactly but whose local timestamps differed.
  Renamed the local files to the authoritative remote versions
  `20260808220459_add_in_app_group_invitation_response.sql` and
  `20260808222536_restrict_rls_auto_enable_execution.sql`, updating current
  operational references without changing either SQL payload or repairing
  remote migration history. Historical session notes retain the original names
  because they describe the rollout sequence at that time.
- Audited the 17 older local migration versions missing from remote history in
  a strict PostgreSQL read-only transaction. All 36 catalog checks passed,
  covering their expected tables, columns, policies, RLS state, triggers,
  indexes, constraints, functions, privileges, generated search vector,
  `pg_trgm`, and `ivfflat.probes` configuration.
- With explicit approval, recorded exactly those 17 already-present versions as
  applied in `supabase_migrations.schema_migrations` using Supabase migration
  repair. This was metadata normalization only: no migration SQL was replayed,
  and no schema object or application row was changed or deleted.

## Rollout boundary

- PR #128 was merged to `main` as `0aa1a07`; the matching Vercel Production
  deployment reached `READY`.
- Both #99 migrations are applied to the shared Supabase project.
- Research-group reads are enabled; writes remain disabled.
- The deployed UI may read membership-scoped group state, while every mutation
  remains unavailable. Write enablement is a separate, explicitly discussed
  rollout decision.

## Validation

- `npm run test:integration:group-papers` (`8/8` passed).
- `npm run typecheck`.
- `npm run lint`.
- `npm run test:unit` (`115/115` passed).
- `TMPDIR=/tmp npm run audit:service-role`.
- `TMPDIR=/tmp npm run build`.
- `git diff --check`.
- Browser gate: `/groups` is protected and redirects to Clerk sign-in, the
  mobile sign-in view renders without a framework error overlay, and no login,
  session, or shared-data mutation was performed.
- `npm run test:e2e:group-workspace`: member, owner, and mobile phases passed
  against disposable local PostgreSQL; report confirmed zero remote mutations
  and zero Clerk sessions. The temporary database and its three synthetic
  profiles were deleted after the run.
- A separate read-only Clerk probe confirmed that the Development publishable
  and secret keys belong to the same instance. Authenticated Clerk invitation
  execution remains intentionally untested in this local-only gate.
- Remote migration preflight: zero groups, active memberships, and
  notifications; both #99 migrations absent; both runtime switches disabled.
- After the approved metadata repair, read-only verification found 25 recorded
  migrations with all 17 audited baseline versions present. Both #99 versions
  and tables remained absent, and both runtime switches remained disabled.
- A secret-scrubbed `supabase db push --dry-run` completed successfully and
  proposed exactly `20260808225719_add_research_group_shared_papers.sql` and
  `20260808230008_wire_research_group_shared_paper_operations.sql`, with no
  seeds or roles. The dry-run applied nothing.
- Applied exactly the two #99 migrations after an unchanged read-only preflight
  showed zero groups, active memberships, and notifications. No seed or role
  file was included, and no application row was inserted, changed, or deleted.
- Post-deploy read-only verification found 27 recorded migrations, both new
  tables with RLS enabled, the two intended authenticated member-read policies,
  explicit read-only authenticated grants, service-role-only writes and RPCs,
  the expected enum values/columns, and a validated notification-source
  constraint. All group/shared-paper/activity/notification counts remained
  zero, and both runtime switches remained disabled.
- The post-deploy migration dry-run is empty. Supabase advisors reported no
  finding on the #99 objects; their warnings concern pre-existing RLS policy
  performance and the existing `vector`/`pg_trgm` extension locations.
- Final local release gates on `e39e555`: lint, typecheck, and production build
  passed before merging PR #128 without waiting for the still-running CI.
- The Vercel Production deployment for merge commit `0aa1a07` reached `READY`.
  Anonymous desktop and 390x844 mobile smoke checks confirmed that `/groups`
  redirects to Clerk sign-in with its original destination, without a Next.js
  error, horizontal overflow, page/console error, or HTTP 5xx response. Vercel
  runtime error logs for the 30-minute deployment window were empty. No sign-in,
  Clerk session, or application-data mutation was performed.
- After explicit approval, changed exactly the singleton runtime configuration
  row from `reads=false, writes=false` to `reads=true, writes=false` through a
  guarded transaction. Post-change read-only verification confirmed the read
  helper is active, all add/remove/preference RPCs still require both switches,
  and group, membership, notification, shared-paper, and activity counts remain
  zero. A fresh anonymous mobile smoke remained free of framework, overflow,
  page/console, and HTTP 5xx errors; no authentication session was created.
