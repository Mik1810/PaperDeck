# Clerk JWT + Supabase RLS Integration

This page describes how to configure Clerk JWT templates so Supabase can verify Clerk-issued JWTs and enforce row-level security policies.

## Current State

The current app repository path uses the direct Postgres connection from
server-only code. User-scoped operations validate the Clerk owner ID in the
application layer and include an explicit owner predicate; this path does not
rely on RLS for enforcement.

The RLS policies in `supabase/schema.sql` use `auth.jwt() ->> 'sub'` as the
owner identifier. Clerk Development and Supabase Third-Party Auth are connected,
and the policies are verified both by deterministic A/B/anonymous database tests
and by a live two-session Clerk Development smoke through the Supabase anonymous
client. Preview and Production remain a separate pre-release gate tracked in
GitHub issue #104; passing Development does not imply that either deployed
environment has passed.

## Setup

### Step 1 — Clerk + Supabase Third-Party Auth

Supabase needs to trust the tokens issued by the specific Clerk instance. Clerk
session tokens include the `sub` user ID used by the existing RLS policies.

1. In the Clerk development instance, open **Connect with Supabase** and apply
   the Supabase compatibility configuration.
2. In the matching Supabase project, open **Authentication** > **Third-Party
   Auth** and add the Clerk integration for that instance.
3. Confirm that a freshly issued Clerk session token contains
   `role: authenticated`. When configuring manually, add this claim before
   enabling the Supabase integration.

Use the default Clerk session token; the deprecated Supabase JWT-template
integration is not needed. Its `sub` claim maps directly to
`auth.jwt() ->> 'sub'` in the RLS policies.

### Step 2 — Verify

After configuration:

1. Deploy the app with `npm run build`
2. Sign in and go through onboarding (select topics)
3. The `createClerkAuthenticatedClient()` function in `src/lib/supabase/server.ts` gets the default Clerk session token via `auth().getToken()` and passes it to Supabase
4. RLS policies will filter rows to only those owned by the authenticated user

## Architecture

### Current app repository path:

```
Scripts → createServiceRoleClient() → Supabase (RLS bypassed)
App   → drizzle-orm → postgres-js → DATABASE_URL → Supabase Postgres
              |
        requireOwnerId() → filters owner_id manually
```

### RLS-authenticated client path:

```
Server Action → auth().getToken()
                     |
               createClerkAuthenticatedClient(anonKey + JWT) → Supabase (RLS enforced)
                     |
               auth.jwt() ->> 'sub' = Clerk user ID
```

### Migration path

1. ✅ `createClerkAuthenticatedClient()` implemented
2. ✅ `verifyClerkRlsAction` smoke test added
3. 🔲 Transition user-scoped repository functions to clerk-authenticated client (see boundary below)
4. ✅ Service role kept for admin/ingestion/embedding workers — documented in per-function JSDoc tags

### Repository boundary (2026-07-06)

All repository functions are tagged with `/** @user-scoped */` or `/** @admin */` in the source.
Run `npm run audit:service-role` to see the breakdown.

| Scope | Count | Description | Current Client |
|-------|-------|-------------|---------------|
| `@user-scoped` | 32 | Reads/writes user-owned data (profile, favorites, interactions, playlists) | Drizzle `db` — owner checks in app code |
| `@admin` | 11 | Shared catalog reads, ranking, embedding refreshes, topic taxonomy | Drizzle `db` |

**Current state (MVP):** Both `@user-scoped` and `@admin` functions use the Drizzle direct connection via `DATABASE_URL`. Owner-id is validated in application code (`requireOwnerId()`). This is acceptable for MVP because:
- Every user-scoped query includes `WHERE owner_id = ?` or equivalent
- The audit script (`scripts/audit-service-role.ts`) verifies no service-role key leaks to client bundles
- RLS policies in `supabase/schema.sql` are active on the authenticated-client
  path and covered by isolation tests

**Migration plan:**
1. Move user-scoped writes (toggleFavorite, toggleReadLater, recordPaperInteraction, etc.) to `createClerkAuthenticatedClient()` 
2. Move user-scoped reads (getFeedState, getLibraryPageData, etc.) to Clerk client
3. Verify every migrated operation through the RLS-backed client before relying
   on it as the authorization boundary
4. Keep admin functions (getAllPapers, getSemanticPaperCandidates, preloadRecommendations) on service role

The `requireOwnerId()` utility in `src/lib/repositories/owner-guard.ts` provides defense-in-depth for all service-role operations that touch user-owned data.

### Negative isolation test

Run `npm run test:integration` with `DATABASE_URL` configured. The Clerk/Supabase
RLS integration suite seeds two temporary profiles, assumes the database
`authenticated` and `anon` roles with request JWT claims, and proves that user A
cannot select, update, delete, or insert data as user B. The test skips when no
database is configured and always removes its temporary rows.

This deterministic database test does not replace a deployment smoke with real
Clerk sessions. GitHub issue #104 gates collaboration separately in Preview and
Production until each target verifies that Supabase accepts its Clerk session
tokens and enforces isolation.

### Live A/B Clerk smoke

1. Create two `+clerk_test` users in the Clerk development instance and complete
   onboarding for both.
2. Configure Clerk and Supabase Third-Party Auth for that instance.
3. Set `PAPERDECK_RLS_USER_A_EMAIL` and `PAPERDECK_RLS_USER_B_EMAIL` to those
   addresses in `.env.local`.
4. Run `npm run test:integration:clerk` with `CLERK_SECRET_KEY`, the Supabase URL,
   and the anonymous key configured in `.env.local`.

The test finds both users through the Clerk Backend API, creates temporary
sessions, mints fresh default session tokens, calls Supabase with the anonymous
client, and always revokes the sessions afterward. It never prints tokens or
needs passwords. The two email identifiers are required local configuration and
are not stored in the repository.

The Development smoke verifies that both tokens contain `role=authenticated`, A and B can
each see only their own profile, and A cannot update B. It performs no persistent
data mutation. Preview and Production execution, identity selection, and redacted
evidence are intentionally deferred to the explicit approval gate in issue #104.

### Collaboration identity webhook

Exact-email discovery stores only an HMAC of the verified primary address. To
remove stale lookup hashes promptly when that address changes or disappears:

1. Set a distinct `PAPERDECK_EMAIL_LOOKUP_PEPPER` of at least 32 random
   characters in every environment. Rotating it requires rebuilding all lookup
   hashes.
2. In Clerk, create a webhook endpoint for
   `https://<app-host>/api/webhooks/clerk` subscribed to `user.created`,
   `user.updated`, and `user.deleted`.
3. Store its signing secret as `CLERK_WEBHOOK_SIGNING_SECRET`.

The route verifies the webhook signature before using the service role. It
never logs or persists the raw address, preserves user-selected names and
preferences, and removes the collaboration identity when no verified primary
email or safe public name remains. Onboarding and Settings also perform an
authenticated lazy sync, so local development does not require a public webhook
receiver.

## Files

- `src/lib/supabase/server.ts` — `createClerkAuthenticatedClient()` using Clerk JWT + anon key
- `src/app/actions.ts` — `verifyClerkRlsAction` smoke test
- `src/app/api/webhooks/clerk/route.ts` — signed primary-email synchronization
- `supabase/schema.sql` — RLS policies checking `auth.jwt() ->> 'sub'`

## References

- Supabase Clerk third-party auth: https://supabase.com/docs/guides/auth/third-party/clerk
- Clerk session tokens: https://clerk.com/docs/guides/sessions/session-tokens
- Clerk test emails and phones: https://clerk.com/docs/guides/development/testing/test-emails-and-phones
