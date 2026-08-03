# Session 57

## Issue #97: durable notification foundation

- Agreed to make notification durability independent from Realtime. The first
  slice uses database-backed refetch/poll behavior; a private Realtime change
  signal is a later #98 optimization.
- Added `notifications` with typed source references, recipient/dedupe
  uniqueness, read/archive state, expiry, indexes, recipient-only RLS, and
  column-limited acknowledgement grants.
- Added private trigger functions that create friendship, group-invitation,
  membership, role, and ownership notifications in the same transaction as the
  authoritative domain mutation.
- Kept blocks, unblocks, unfriend, declines, shared-paper events, rendered
  messages, emails, tokens, and free-form payloads outside this notification
  store. Shared-paper aggregation remains #99.
- Made source deletion cascade only to derived notifications, while actor
  deletion retains the row with a generic actor. This avoids orphan pointers and
  prevents notification constraints from blocking account or group cleanup.
- Added a server-only repository with explicit recipient predicates, stable
  cursor pagination, public actor projections, unread counting,
  read-all/read-one operations, and archive support.
- Added an opt-in synthetic PostgreSQL integration suite for event atomicity,
  deduplication, RLS isolation, restricted updates, source cleanup, and bounded
  expiry cleanup. It creates no Clerk sessions and was not run against the shared
  database.
- Corrected the suite cleanup to delete synthetic groups before their owner
  profiles and to close the database connection in a `finally` block. The first
  local run exposed this fixture-order problem after four passing cases; both
  complete reruns then passed all five cases.
- Added a daily free GitHub Actions retention job. It deletes expired rows in
  bounded batches and reports counts only; normal reads also exclude expired
  rows.
- Gated scheduled retention behind the repository variable
  `NOTIFICATION_RETENTION_ENABLED=true`. The absent/false default keeps the job
  inert when code merges before the shared-database migration; manual dispatch
  remains available for the rollout dry run.
- Updated the SQL snapshot, Drizzle schema/relations, database/social/charter
  documentation, roadmap, changelog, package commands, and workflow definition.
- Found and repaired a pre-existing `supabase/schema.sql` drift: the #95, #107,
  #96, and related RLS optimization migrations were absent from the standalone
  snapshot even though they were already represented in migrations and Drizzle.
  The snapshot now creates the research-group and notification schema in the
  correct dependency order.
- Updated issue #97 with the completed local slice, scope decisions, validation
  evidence, and the remaining isolated-database/release gate; the issue stays
  open.
- Added a follow-up #97 comment with the completed Supabase-local gate and
  standalone-snapshot evidence.

## Validation

- `npm run typecheck`
- `npm run lint`
- `npm run audit:service-role` (passed; five notification repository functions
  are recognized as explicitly owner-scoped)
- `npm run test:unit` (`106/106` passed)
- `npm run build`
- `npm run test:integration:notifications` passed all five cases against an
  isolated Supabase PostgreSQL 17.6 container (`5/5`). It was run once after the
  incremental baseline-plus-migration path and again after building solely from
  the repaired `supabase/schema.sql` snapshot.
- Parsed `.github/workflows/prune-notifications.yml` successfully as YAML.
- `git diff --check`
- Confirmed the notification migration appended to `supabase/schema.sql` is
  byte-for-byte identical to the versioned migration body.
- `supabase db lint` found no errors in `public` or `private`.
- Independent SQL checks confirmed RLS, two recipient policies, three enabled
  notification triggers, only `SELECT` plus column-level acknowledgement grants,
  no authenticated execution of private helpers, and zero synthetic rows after
  cleanup.
- The temporary container and its synthetic-only volume were deleted after the
  checks; port `54322` is free again.
- The remote migration, retention workflow, and Realtime behavior remain
  intentionally unexecuted pending review and explicit rollout approval.

## Publishing

- Published `agent/durable-notifications` with separate snapshot-repair and
  notification-feature commits.
- Opened draft PR #115 against `main`; CI was allowed to start but was not
  awaited.
- Renamed and narrowed issue #97 to durable notification events. Its body now
  records Realtime as a #98 optimization, shared-paper aggregation as #99, and
  the still-pending shared-database rollout gate.
- Confirmed `NOTIFICATION_RETENTION_ENABLED` is absent from repository
  variables, so scheduled cleanup remains disabled after merge until explicitly
  enabled.
