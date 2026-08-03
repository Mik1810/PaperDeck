# Session 58

## Issue #97: safe notification-retention dispatch

- Reviewed whether notification expiry should use a database trigger, Supabase
  Cron, or the existing GitHub Actions scheduler. Kept the existing scheduler:
  elapsed time does not fire PostgreSQL data-change triggers, while the actual
  bounded cleanup remains encapsulated in the private database function.
- Changed the manual `Prune expired notifications` dispatch to default to
  `dry_run=true`. Manual launches now count expired rows unless deletion is
  explicitly selected.
- Preserved scheduled behavior: scheduled runs still use write mode, but the
  schedule remains inert until the repository variable
  `NOTIFICATION_RETENTION_ENABLED=true` is separately approved and configured.
- Did not dispatch the workflow, enable retention, or modify notification data.

## Validation

- Parsed `.github/workflows/prune-notifications.yml` as YAML.
- Verified manual dispatch resolves to dry-run by default and scheduled events
  still resolve to write mode behind the repository-variable gate.
- `git diff --check`
