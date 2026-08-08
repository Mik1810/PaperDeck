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

## Rollout boundary

- Work is local on `codex/group-shared-paper-foundation`.
- Neither #99 migration has been applied to the shared Supabase project.
- Both research-group runtime switches remain disabled.
- Remote migration, UI release, and switch enablement require a separate
  explicitly discussed rollout decision.

## Validation

- `npm run test:integration:group-papers` (`8/8` passed).
- `npm run typecheck`.
- `npm run lint`.
- `npm run test:unit` (`115/115` passed).
- `TMPDIR=/tmp npm run audit:service-role`.
- `TMPDIR=/tmp npm run build`.
- `git diff --check`.
