# Session 56

## Development-only Clerk/Supabase testing

- Adopted a strict rule that automated tests never authenticate an existing
  Clerk Production user or create a Production session.
- Removed the Production Playwright RLS wrapper and its npm command.
- Restricted the shared live harness to the Clerk Development instance, an
  `sk_test_` key, and two dedicated `+clerk_test` identities. Production
  targets, `sk_live_` keys, and ordinary addresses are rejected before Clerk
  session creation.
- Retained the non-mutating profile isolation proof, masked evidence, and
  mandatory temporary-session revocation for Development.
- Invalidated the earlier Production result because one selected identity was
  not a dedicated test account. Both temporary sessions from that run were
  confirmed revoked and no persistent database mutation occurred.
- Removed masked actor identifiers from the versioned session record.
- Local-only Production smoke variables are removed manually by the repository
  owner; no `.env.local` value was read, printed, or changed during this cleanup.

## Validation

- `npm run lint`
- `npm run typecheck`
- `node --import tsx --test tests/unit/clerk-supabase-live-support.test.ts`
  (`8/8` passed)
- `git diff --check`
- Repository scan found no Production smoke command, local Production-variable
  name, or masked Production actor identifier.
- The live Development smoke was intentionally not run, so this cleanup created
  no Clerk session and made no database request.
