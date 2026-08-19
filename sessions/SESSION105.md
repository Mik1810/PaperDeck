# Session 105 — Source-ordered Clerk collaboration identities

## Scope

Implemented GitHub issue #223 so delayed or replayed Clerk user webhooks cannot
replace a newer exact-email discovery identity or recreate one after account
closure.

## Changes

- Added private per-owner Clerk sync state with the latest upstream
  `updated_at` and a permanent account-closure boundary.
- Added a service-role-only public RPC backed by a private
  `SECURITY DEFINER` implementation with an empty search path. The public
  wrapper remains `SECURITY INVOKER`; `PUBLIC`, `anon`, and `authenticated`
  cannot execute either mutation surface or access the private state table.
- Made webhook updates strictly newer-only. Duplicate and stale payloads are
  successful no-ops, while missing verified email or an invalid public name
  removes the identity and still advances source state.
- Routed authenticated lazy synchronization through Clerk's current
  `updatedAt`. It may safely reapply the same version so Settings and onboarding
  changes can update preferences or recreate an identity after the display name
  becomes valid.
- Extended account deletion to lock and close the same sync state before group
  lifecycle and identity removal, keeping rollback and duplicate-delivery
  behavior atomic.

## Validation

- Rebuilt the canonical disposable `paperdeck_test` database with all 36
  migrations and its synthetic catalog fixture.
- Clerk identity/deletion integration suite: 10/10 passed, covering
  newer-to-older delivery, duplicate replay, invalid identity removal, stale
  recreation, delete-to-late-update, preference preservation, exact-email
  lookup, unique-hash rollback, lifecycle regressions, concurrency, and
  service-role-only privileges.
- Focused webhook/identity unit suite: 8/8 passed, covering signed update/deletion payloads,
  tamper rejection, upstream timestamps, verified-primary-email selection,
  invalid display names, RPC arguments, and generic retryable failures.

No migration or application change was applied to the hosted database. During
validation, one incorrectly scoped test command inserted four uniquely named
synthetic profiles into the hosted database before failing on the absent new
table. The command was stopped; all 27 foreign-key reference columns were
verified empty for those exact IDs, the four profiles were deleted in one
guarded transaction, and a final query confirmed zero remaining rows.
