# Session 36

## Clerk Development RLS test recovery

- Confirmed the current Clerk Development instance contains one real account and the two existing official test accounts required by the live A/B RLS smoke test.
- Restored the two test-user identifiers only in ignored local configuration; no email address, password, token, or secret was added to version control.
- Confirmed both test users have onboarded Supabase profiles and collaboration identities without reading stored HMAC lookup hashes.
- Hardened temporary-session cleanup: sessions are created sequentially and tracked immediately, cleanup failures fail the test, and missing-user errors do not include email identifiers.
- Passed the live Clerk/Supabase A/B RLS smoke test, typecheck, lint, 58 unit tests, and service-role boundary audit.
- Verified through Clerk after the test that both temporary sessions created by the smoke test were revoked.
- Found one older active session on test user A; it was left unchanged pending explicit approval.
- Confirmed the test keeps JWTs only in memory and contains no password handling, token logging, or filesystem persistence.
- Audited Clerk Production through a temporary local credential: five users exist, one matches the declared real account and four are legacy non-real accounts; no Production test marker is present.
- Matched four Production users to existing Supabase profiles; the fifth is Clerk-only and has no application profile.
- Removed the temporary Production audit credential from local configuration immediately after the read-only inventory.
- Production users and data were not modified.
