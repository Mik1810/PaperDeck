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
Server Action → createServiceRoleClient() → Supabase (RLS bypassed)
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
3. 🔲 Migration: transition user-scoped repository functions from service role to clerk-authenticated client
4. 🔲 Keep service role for admin/ingestion/embedding workers

## Files

- `src/lib/supabase/server.ts` — `createClerkAuthenticatedClient()` using Clerk JWT + anon key
- `src/app/actions.ts` — `verifyClerkRlsAction` smoke test
- `supabase/schema.sql` — RLS policies checking `auth.jwt() ->> 'sub'`

## References

- Supabase External Auth (Clerk): https://supabase.com/docs/guides/auth/auth-clerk
- Clerk Session Tokens: https://clerk.com/docs/security/session-tokens
- Supabase JWKS Verification: https://supabase.com/docs/guides/auth/auth-deep-dive/auth-deep-dive-jwks
