# Session 55

## Production Clerk/Supabase release gate (#104)

- Reworked the default live Clerk/Supabase command into a non-mutating
  `profile-isolation` smoke. It uses fresh Clerk session tokens to prove that
  each actor sees only its own profile and that a cross-profile update affects
  no rows.
- Added explicit target guards: Development accepts only Clerk Development keys
  and official test identities; Production accepts only a Production key and
  refuses Clerk test-mode identities.
- Production additionally requires its Clerk/Supabase values to be injected
  before `.env.local` is loaded, preventing a relabeled local Development run
  from becoming release evidence.
- An explicitly declared target can no longer be silently skipped when its
  credentials are missing; it fails before creating a Clerk client or session.
- Separated the temporary research-group lifecycle into
  `npm run test:integration:clerk-groups` and hard-restricted it to Development.
- Added redacted JSON evidence with masked actor/Supabase identifiers, target,
  scope, timestamp, and exact temporary-session create/revoke counts. No email,
  password, session token, secret, or unmasked identifier is logged or stored.
- Corrected deployment guidance so Vercel `*.vercel.app` Preview deployments use
  Clerk Development credentials while the custom-domain Production deployment
  uses Clerk Production credentials.

## Validation

- TypeScript typecheck: passed.
- Targeted safeguard tests: 9 passed.
- Targeted ESLint: passed.
- Full unit suite: 107 passed.
- Full ESLint and `git diff --check`: passed.
- Development `profile-isolation` live smoke: passed with two temporary
  sessions created and both revoked; no database mutation occurred.
- Read-only shared-Supabase preflight found RLS enabled on `profiles`, the
  expected self-only select/insert/update policies, 94 profiles, 5
  collaboration identities, no orphan identity, no research groups or
  memberships, and both group switches disabled. Of the profiles, 8 have a
  Clerk-shaped owner ID and 86 do not; no rows were inspected for email or hash
  content and no cleanup was attempted.
- Vercel project access confirmed current ready Preview and Production
  deployments, but the available project API does not expose environment
  variable scopes. The local Vercel CLI had no authenticated credentials, so
  it could not safely verify those scopes without an explicit login and
  temporary environment pull.
- After reviewing the operational cost, the release decision was simplified:
  Preview is no longer a separate RLS gate. Production is the only blocking
  smoke before collaboration can be enabled.
- Production live evidence remains pending.
- An authenticated Vercel CLI attempt confirmed that encrypted values are not
  disclosed to agent processes. The CLI-added local OIDC token and all temporary
  probe artifacts were removed without displaying their contents; no Preview
  session was created.
- A user-run Preview attempt initially skipped and, after the explicit-target
  guard, failed before Clerk client creation because Vercel supplied an empty
  `CLERK_SECRET_KEY`. Read-only metadata then confirmed that all relevant Vercel
  variables are `sensitive`, so their values are intentionally unavailable to
  local `env run` processes.
- The same sensitive Clerk publishable/secret variable entries currently target
  both Preview and Production, while Production publicly identifies as Clerk
  `live`. The team chose not to split these variables because Preview was
  removed from the RLS release gate. No Vercel variable was changed.
- No Production identity, session, or database row was created, modified, or
  deleted.
