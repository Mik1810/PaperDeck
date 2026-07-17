# Session 38

## Clerk JWT and Supabase RLS foundation audit

- Audited GitHub issue #92 against the deterministic RLS suite, the live Clerk Development A/B smoke, collaboration isolation tests, and the service-role boundary audit.
- Redacted the two complete test-user email identifiers from a historical issue comment without recording them in the repository.
- Rescoped #92 to the implemented JWT/RLS foundation and moved requirements that depend on later product layers to dedicated follow-ups.
- Added #103 for authenticated-route cache, PWA network-only, and shared-device logout automation.
- Added #104 as the explicit Preview/Production Clerk/Supabase isolation gate; it does not authorize creating Production identities.
- Kept the owner/admin/member/outsider/revoked matrix in #95, where group roles and revocation semantics are introduced.
- Updated the RLS documentation and roadmap to distinguish the verified Development path from the unverified deployment gates.

## Validation

- `npm run audit:service-role`
- `node --import tsx --test tests/integration/clerk-supabase-rls.test.ts` — 11 passed
- `npm run test:integration:clerk` — 1 passed; temporary-session cleanup succeeded
