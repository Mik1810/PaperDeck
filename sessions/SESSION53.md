# Session 53

## Research-group invitations and membership lifecycle (#96)

- Added `research_group_invitations` with a seven-day lifecycle, a single
  pending invitation per group/recipient, and terminal states for acceptance,
  decline, cancellation, revocation, and expiry.
- Generate 256-bit URL-safe tokens in server-only code, return the raw token
  only once, and persist only a SHA-256 digest. Terminal transitions erase the
  digest.
- Added service-role-only transactional RPCs for invitation creation/response,
  cancellation/revocation, role changes, member removal, and voluntary leave.
- Enforced owner/admin/member hierarchy, explicit acceptance, exact-email
  discovery opt-in, recipient policy, friendship requirements, bidirectional
  blocks, group state, and database read/write switches.
- Block creation revokes pending invitations immediately. Clerk account deletion
  revokes pending invitations in the same transaction before collaboration
  identity cleanup.
- Added minimal incoming/outgoing repository projections without raw email,
  internal owner identifiers, hashes, private interests, or history.
- No group UI, notification delivery, or Clerk user/session change was
  performed.

## Local validation

- Applied the collaboration, research-group, account-deletion, and #96
  migrations to a disposable PostgreSQL 17 cluster under `/tmp`.
- `npm run test:integration:group-invitations` — 6 passed:
  - role, opt-in, policy, friendship, and block checks;
  - concurrent duplicate acceptance and one membership;
  - altered/expired tokens and state changes after creation;
  - decline, cancellation, and revocation;
  - role/removal/leave hierarchy plus immediate RLS loss;
  - account-deletion revocation and service-role-only privileges.
- Invitation-token unit tests — 3 passed.
- `npm run typecheck` — passed.
- Targeted ESLint — passed after removing one unused import.
- The isolated cluster was stopped and moved to trash. It used no Clerk or
  Supabase credential and contained only random synthetic identifiers.

## Shared Supabase validation

- Applied `20260729124131_add_research_group_invitations.sql` to the shared
  PaperDeck Supabase project after confirming the #95/#107 baseline, zero
  groups/memberships, and disabled read/write switches.
- Ran the same six lifecycle cases with random synthetic identifiers: 6 passed.
- Verified exact cleanup: zero synthetic profiles, collaboration identities,
  friendships, blocks, groups, memberships, and invitations remained.
- Verified RLS enabled, direct table/RPC access denied to `authenticated`, RPC
  execution granted to `service_role`, and both kill switches restored to
  disabled.
- The performance advisor identified one #96-specific InitPlan warning. Added
  and applied `20260803091443_optimize_research_group_invitation_rls.sql`, which
  wraps `auth.jwt()` in a scalar `select` without changing authorization.
- Re-ran security and performance advisors: no #96-specific finding remains.
  Existing project-wide findings are unchanged and remain separate work.
- The Supabase MCP assigned the registered timestamps at application time; the
  local migration filenames were aligned to those registered versions to avoid
  future migration drift.
