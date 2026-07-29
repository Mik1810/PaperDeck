# Session 51

## Private research-group foundation (#95)

- Chose `research_groups` and `research_group_members` as a collaboration
  domain separate from private playlists.
- Made one active `owner` membership the sole ownership source.
- Added deferred database invariants for exactly one owner and a valid active
  non-owner successor.
- Added private, database-backed read and write switches that default to off.
- Added RLS so active members can read group metadata while raw membership
  reads expose only the caller's own row; authenticated clients have no direct
  write grants.
- Added a follow-up policy migration after the Development performance advisor
  identified a per-row `auth.jwt()` evaluation; the optimized policy preserves
  the same authorization rule.
- Added centralized TypeScript owner/admin/member permission evaluation and
  repository projections that omit Clerk IDs, emails, and lookup hashes.
- Added deterministic transactional account-closure succession: selected
  successor, oldest admin, oldest member, then group deletion. Account closures
  are serialized so simultaneous deletion of an owner and successor cannot
  leave an ownerless group.
- Kept the Clerk deletion webhook unchanged until the lifecycle routine is
  verified against Supabase Development and explicitly approved for rollout.
- Did not add invitations, shared paper items, notifications, or UI; those
  remain in the dependent issues.
- Posted a progress summary to GitHub issue #95 and kept it open for the remote
  validation gate.

## Validation

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit` — 89 passed
- `npm run audit:service-role` — passed and classified the new repository's
  five user-scoped functions and one admin lifecycle function.
- `npm run build`
- Applied the migration to an isolated PostgreSQL 17 cluster in `/tmp`.
- `tests/integration/research-groups-rls.test.ts` — 9 passed against that
  isolated cluster.
- `tests/integration/research-groups-rls.test.ts` — 9 passed against Supabase
  Development in about 14 seconds.
- Post-run Development verification: zero `group-test-*` profiles or playlists,
  zero groups or memberships, and both runtime switches restored to disabled.
- `npm run test:integration:clerk` — passed with two existing Clerk Development
  test users. The smoke proved owner, outsider, member, and revoked group access,
  self-only raw membership rows, and direct-write denial.
- Independent post-run verification found zero `Clerk RLS *` groups, zero group
  rows or memberships, and both switches disabled. Both temporary Clerk session
  revocations and the database cleanup completed without error.

## Development migration

The two migrations were applied to the healthy PaperDeck Supabase Development
project on PostgreSQL 17. Verification found zero groups and memberships, both
runtime switches disabled, RLS enabled, no authenticated write grants, and the
account-closure routine executable only by `service_role`.

The local migration filenames were aligned to the versions recorded by Supabase:
`20260729105307` and `20260729105428`.

Security advisors reported no new research-group warning. The performance
advisor initially identified the membership policy's direct `auth.jwt()` call;
the follow-up migration wrapped it in a scalar subquery. A Development
`EXPLAIN` confirmed both the JWT lookup and read switch are one-time `InitPlan`
nodes, even though the advisor continued to display the cached warning. Other
advisor items predate this work; unused-index notices on the empty group tables
are expected until the pilot creates rows.

## Completed external validation scope

The approved synthetic Development validation used this scope:

- temporarily enable both research-group switches;
- insert four non-Clerk profiles named `Group A` through `Group D`, with owner
  ids under the unique `group-test-<letter>-<uuid>` prefix;
- create at most four synthetic groups at once, with only those four profiles as
  owner/admin/member;
- create one temporary private playlist owned by synthetic profile A for the
  isolation regression;
- run the nine group RLS/lifecycle cases;
- delete every group, membership, playlist, and synthetic profile and restore
  both switches to disabled.

All nine synthetic cases and the Clerk Development JWT/RLS A/B smoke passed,
with cleanup verified. Production and Clerk webhook wiring remain out of scope
without separate approval.
