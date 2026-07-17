# Session 35

## Credential recovery after workstation compromise

- Recreated `.env.local` from `.env.example` and restored the required Clerk, Supabase, Postgres, and email-lookup configuration.
- Rotated compromised credentials instead of attempting to recover old values: Clerk development/production secrets, Clerk webhook signing secret, Supabase named backend secrets, and the Postgres password.
- Assigned separate Supabase secret keys to local development, GitHub Actions, and Vercel Production.
- Migrated consumers to Supabase publishable/secret keys and deactivated the legacy `anon` and `service_role` API keys after verification.
- Updated Vercel Production configuration and used the Supabase session pooler on port `5432`, matching the current `postgres.js` prepared-statement behavior.
- Recreated and verified the Clerk Production webhook for `user.created`, `user.updated`, and `user.deleted`.
- Restored GitHub Actions secrets, including the rotated `DATABASE_URL`, and verified the arXiv ingestion dry-run.

## Validation and follow-up

- Passed service-role audit, lint, typecheck, 58 unit tests, database/RLS integration tests, production build, and local desktop/mobile Playwright coverage.
- Identified and fixed the mobile PWA update prompt intercepting feed and settings controls; delivered through PR #102.
- Repaired PR CI after the Postgres password rotation left the GitHub `DATABASE_URL` secret stale; the rerun passed along with Vercel checks.
- Live Clerk/Supabase A/B isolation remains optional locally and requires `PAPERDECK_RLS_USER_A_EMAIL` and `PAPERDECK_RLS_USER_B_EMAIL` test identifiers.
