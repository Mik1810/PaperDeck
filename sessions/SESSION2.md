# Session 2

Date: 2026-07-01

## Goal

Finish the production authentication and deployment setup that was still open after `SESSION1.md`.

## Starting Point

At the end of Session 1, PaperDeck had:

- a working Next.js scaffold;
- Clerk integrated in the codebase;
- Supabase schema applied;
- an initial Vercel deployment at `https://paper-deck-ecru.vercel.app/`;
- a known issue where protected routes on the public Vercel URL were still affected by Clerk development-key behavior.

## Summary

This session completed the production path for authentication and public access:

- added a custom production domain;
- configured Clerk as a production secondary application;
- completed Clerk DNS and SSL setup;
- configured Google OAuth production credentials;
- verified real Google sign-in in production.

The current public app URL is:

```text
https://paperdeck.michaelpiccirilli.it/
```

## Work Completed

### Vercel Custom Domain

- Added `paperdeck.michaelpiccirilli.it` to the Vercel project.
- Added the required Register.it CNAME record:

```text
paperdeck.michaelpiccirilli.it -> ab16e0cbc5f8cd8f.vercel-dns-017.com
```

- Waited for Vercel to validate DNS and issue the HTTPS certificate.
- Verified that `https://paperdeck.michaelpiccirilli.it/` responds and redirects to `/feed`.

### Clerk Production Instance

- Created/configured a Clerk production instance for PaperDeck.
- Chose **Secondary application** because `michaelpiccirilli.it` is already used for a personal portfolio.
- Configured Clerk for:

```text
Application: paperdeck.michaelpiccirilli.it
Frontend API: clerk.paperdeck.michaelpiccirilli.it
Account portal: accounts.paperdeck.michaelpiccirilli.it
```

- Added Clerk live keys to local `.env.local` and to Vercel Production environment variables.
- Verified the deployed app serves `pk_live_...` instead of `pk_test_...`.

### Clerk DNS And SSL

- Added and verified all Clerk production DNS records on Register.it:

```text
clerk.paperdeck.michaelpiccirilli.it -> frontend-api.clerk.services
accounts.paperdeck.michaelpiccirilli.it -> accounts.clerk.services
clkmail.paperdeck.michaelpiccirilli.it -> Clerk mail service
clk._domainkey.paperdeck.michaelpiccirilli.it -> Clerk DKIM service
clk2._domainkey.paperdeck.michaelpiccirilli.it -> Clerk DKIM service
```

- Verified Clerk DNS reached `5/5 Verified`.
- Confirmed Clerk SSL certificates were issued for Frontend API and Account portal.
- Verified the Clerk JS asset path now resolves:

```text
https://clerk.paperdeck.michaelpiccirilli.it/npm/@clerk/clerk-js@6/dist/clerk.browser.js
```

### Google OAuth Production

- Configured Google Cloud OAuth consent for the PaperDeck production login.
- Created a Google OAuth Web client named `PaperDeck Production`.
- Configured Google OAuth with:

```text
Authorized JavaScript origin:
https://paperdeck.michaelpiccirilli.it

Authorized redirect URI:
https://clerk.paperdeck.michaelpiccirilli.it/v1/oauth_callback
```

- Added the Google OAuth Client ID and Client Secret to Clerk's production Google SSO connection.
- Left Clerk Google scopes at the default/minimum values:

```text
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
```

- Verified Google login succeeds in production and redirects the signed-in user to `/onboarding`.

## Verification

Verified production routing:

```text
/        -> 307 to /feed
/sign-in -> 200
/sign-up -> 200
/feed    -> 307 to /sign-in?redirect_url=... for an unauthenticated browser request
```

Important Clerk behavior:

- Browser-like unauthenticated requests to protected routes redirect correctly to `/sign-in`.
- Plain command-line requests without browser-like headers can receive Clerk's protected-route `/404` rewrite with `session-token-and-uat-missing`. This is expected and does not indicate a missing Next.js route.

## Files Updated

- `docs/deployment.md`: current production deployment, Clerk DNS, SSL, and smoke-test details.
- `sessions/SESSION1.md`: appended production deployment follow-up notes before this dedicated Session 2 file existed.
- `CHANGELOG.md`: recorded production deployment, Clerk DNS/SSL, and Google OAuth verification.
- `README.md`: updated the public URL to `https://paperdeck.michaelpiccirilli.it/`.

## Commits

- `528d85c` - Document Vercel deployment status
- `18369ad` - Prepare Clerk production configuration
- `31de106` - Document custom domain Clerk deployment
- `2ed7de1` - Document Clerk DNS certificate verification
- `7e98caf` - Document Google OAuth production verification

## Current Status

Production authentication is working end to end:

- custom domain: done;
- Vercel HTTPS: done;
- Clerk production keys: done;
- Clerk DNS: done;
- Clerk SSL: done;
- Google OAuth production login: done;
- redirect after first sign-up to `/onboarding`: verified.

## Open Questions

- Configure Clerk JWT so Supabase can enforce the prepared RLS policies directly.
- Decide whether local development should switch back to Clerk development keys while keeping live keys only on Vercel Production.
- Post-feed benchmark for `BAAI/bge-small-en-v1.5` vs `intfloat/e5-small-v2` vs `sentence-transformers/all-MiniLM-L6-v2`.

## Next Suggested Step

Add Supabase server clients and wire persistent user data:

- create or upsert an app user after Clerk login;
- persist onboarding topic selections;
- persist favorites;
- persist dismiss/open/save paper interactions;
- persist private playlists.
