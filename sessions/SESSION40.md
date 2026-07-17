# Session 40

## Exact-email discovery opt-in

- Audited the existing Supabase collaboration identities without exposing email addresses or lookup hashes.
- Confirmed four existing identities were discoverable: the masked Development and Production owner identities and the two masked Development test identities.
- Changed the canonical SQL schema, Drizzle schema, and missing-identity repository fallback to `discoverableByEmail = false`.
- Added a migration that disables discovery for existing identities without deleting profiles, HMAC lookup values, relationships, or invitation preferences.
- Applied the migration transactionally to the configured Supabase project with a four-row guard and verified all four existing identities are now undiscoverable.
- Reworded Settings so enabling discovery is an explicit consent action for people who already know the exact address.
- Added database-backed coverage proving a newly inserted collaboration identity is undiscoverable by default and that owner opt-in/opt-out takes effect through RLS.

## Validation

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit` — 60 passed
- `node --import tsx --test tests/integration/clerk-supabase-rls.test.ts` — 13 passed
- Playwright `mobile-chrome` exact-email opt-in Settings test — 1 passed
- `npm run build`
- Supabase post-migration audit — 4 identities, 0 discoverable, default `false`, 0 temporary RLS profiles
