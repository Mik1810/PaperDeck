# Clerk JWT + Supabase RLS Integration

This page describes how to configure Clerk JWT templates so Supabase can verify Clerk-issued JWTs and enforce row-level security policies.

## Current State

The MVP uses `SUPABASE_SERVICE_ROLE_KEY` for all database access via server actions. This bypasses all RLS policies. Access control is done in the application layer by checking `auth().userId` from Clerk.

The RLS policies in `supabase/schema.sql` are already written and use `auth.jwt() ->> 'sub'` as the owner identifier. They are dormant until Clerk JWTs are configured.

## Setup

### Step 1 — Supabase JWKS Configuration

Supabase needs to know how to verify Clerk's JWTs. Clerk issues session tokens that already include the `sub` claim (user ID), along with `sid` (session ID) and other standard claims.

1. Go to [Supabase Dashboard](https://supabase.com/dashboard) > your project > **Authentication** > **Settings**
2. Under **External Authentication Providers**, enable **Clerk**
3. Set the **JWKS URL** to: `https://api.clerk.com/v1/jwks`
4. Save

**No Clerk JWT template is needed.** The default Clerk session token already carries `sub`, which maps directly to `auth.jwt() ->> 'sub'` in Supabase RLS policies.

### Step 2 — Verify

After configuration:

1. Deploy the app with `npm run build`
2. Sign in and go through onboarding (select topics)
3. The `createClerkAuthenticatedClient()` function in `src/lib/supabase/server.ts` gets the default Clerk session token via `auth().getToken()` and passes it to Supabase
4. RLS policies will filter rows to only those owned by the authenticated user

## Architecture

### Before (MVP — service role only):

```
Scripts → createServiceRoleClient() → Supabase (RLS bypassed)
App   → drizzle-orm → postgres-js → DATABASE_URL → Supabase Postgres
              |
        requireOwnerId() → filters owner_id manually
```

### After (with Clerk JWT):

```
Server Action → auth().getToken({ template: 'supabase' })
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
| `@user-scoped` | 27 | Reads/writes user-owned data (profile, favorites, interactions, playlists) | Drizzle `db` (service-role) — owner checks in app code |
| `@admin` | 9 | Shared catalog reads, ranking, embedding refreshes, topic taxonomy | Drizzle `db` (service-role) |

**Current state (MVP):** Both `@user-scoped` and `@admin` functions use the Drizzle direct connection via `DATABASE_URL`. Owner-id is validated in application code (`requireOwnerId()`). This is acceptable for MVP because:
- Every user-scoped query includes `WHERE owner_id = ?` or equivalent
- The audit script (`scripts/audit-service-role.ts`) verifies no service-role key leaks to client bundles
- RLS policies in `supabase/schema.sql` are written and ready for activation

**Migration plan:**
1. Move user-scoped writes (toggleFavorite, toggleReadLater, recordPaperInteraction, etc.) to `createClerkAuthenticatedClient()` 
2. Move user-scoped reads (getFeedState, getLibraryPageData, etc.) to Clerk client
3. Activate RLS policies in production
4. Keep admin functions (getAllPapers, getSemanticPaperCandidates, preloadRecommendations) on service role

The `requireOwnerId()` utility in `src/lib/repositories/owner-guard.ts` provides defense-in-depth for all service-role operations that touch user-owned data.

## Files

- `src/lib/supabase/server.ts` — `createClerkAuthenticatedClient()` using Clerk JWT + anon key
- `src/app/actions.ts` — `verifyClerkRlsAction` smoke test
- `supabase/schema.sql` — RLS policies checking `auth.jwt() ->> 'sub'`

## References

- Supabase External Auth (Clerk): https://supabase.com/docs/guides/auth/auth-clerk
- Clerk Session Tokens: https://clerk.com/docs/security/session-tokens
- Supabase JWKS Verification: https://supabase.com/docs/guides/auth/auth-deep-dive/auth-deep-dive-jwks
