# Deployment Notes

## Current Deployment

- Public URL: <https://paperdeck.michaelpiccirilli.it/>
- Vercel preview URL: <https://paper-deck-ecru.vercel.app/>
- Platform: Vercel
- Checked on: 2026-07-01

Smoke-test result:

- `/` returns `307` and redirects to `/feed`.
- `/sign-in` returns `200`.
- `/sign-up` returns `200`.
- `/feed` returns `307` to `/sign-in?redirect_url=...` for an unauthenticated browser request.
- The deployed app uses Clerk production keys (`pk_live_...` / `sk_live_...`) on the custom domain.
- Clerk DNS configuration is verified and SSL certificates are issued for the Frontend API and Account portal.
- Google OAuth production credentials are configured in Clerk and sign-in reaches `/onboarding`.

Plain command-line requests without browser-like headers can still receive a Clerk protected-route rewrite:

```text
x-clerk-auth-status: signed-out
x-clerk-auth-reason: protect-rewrite, session-token-and-uat-missing
x-matched-path: /404
```

This is expected for a non-browser request without Clerk session context. A browser-style request receives the sign-in redirect.

## Clerk Production Requirement

For a public deployment, Clerk should use a production instance and production keys:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...`
- `CLERK_SECRET_KEY=sk_live_...`

The current custom-domain Vercel deployment uses production Clerk keys. Development keys (`pk_test_...` / `sk_test_...`) are for local development only.

Clerk's production deployment guide also requires production OAuth credentials for social login providers. For PaperDeck, that means configuring Google OAuth for the production Clerk instance before launch.

Clerk's production guide assumes a domain you own and DNS access. PaperDeck uses `paperdeck.michaelpiccirilli.it` as a secondary application under the `michaelpiccirilli.it` domain.

## Local Clerk Development

Local development should use Clerk development keys:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
PAPERDECK_DEV_AUTH=false
```

Production keys (`pk_live_...` / `sk_live_...`) are tied to the production custom domain and are not valid for `localhost`.

For UI and latency debugging without Clerk, PaperDeck also supports a local-only bypass:

```env
PAPERDECK_DEV_AUTH=true
PAPERDECK_DEV_OWNER_ID=local-dev-user
```

The bypass is ignored in production because it only activates when `NODE_ENV !== "production"`. Use it to isolate application/UI latency from Clerk latency; use Clerk development keys when a local test should resemble the production authentication flow.

## Vercel Environment Variables

Production and Preview should have these values configured in Vercel:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_replace_me
CLERK_SECRET_KEY=sk_live_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/feed
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/onboarding
CLERK_AUTHORIZED_PARTIES=https://paperdeck.michaelpiccirilli.it
PAPERDECK_DEV_AUTH=false

NEXT_PUBLIC_SUPABASE_URL=https://replace-me.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=replace_me
SUPABASE_SERVICE_ROLE_KEY=replace_me
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` in client-side code.

`CLERK_AUTHORIZED_PARTIES` is optional while developing, but should be set in production to the final app origin. Use a comma-separated list if more than one origin is intentionally allowed.

## Production Setup Checklist

1. Use the existing `michaelpiccirilli.it` domain.
2. Add `paperdeck.michaelpiccirilli.it` to the Vercel project.
3. In Clerk, create a production instance from the current development instance.
4. Configure Clerk as a secondary application for `paperdeck.michaelpiccirilli.it` and complete the DNS records shown by Clerk.
5. Configure Google as a production SSO connection with custom OAuth credentials. Copy the exact redirect URI shown by Clerk into Google Cloud Console.
6. In Vercel, replace Clerk environment variables in Production with the `pk_live_...` and `sk_live_...` keys.
7. Set `CLERK_AUTHORIZED_PARTIES` to `https://paperdeck.michaelpiccirilli.it`.
8. Redeploy the Vercel project.

The Clerk DNS records currently include:

- `clerk.paperdeck.michaelpiccirilli.it` -> `frontend-api.clerk.services`
- `accounts.paperdeck.michaelpiccirilli.it` -> `accounts.clerk.services`
- `clkmail.paperdeck.michaelpiccirilli.it` -> Clerk mail service
- `clk._domainkey.paperdeck.michaelpiccirilli.it` -> Clerk DKIM service
- `clk2._domainkey.paperdeck.michaelpiccirilli.it` -> Clerk DKIM service

## Smoke Test

Use browser-like headers for protected routes when testing with `curl`:

```bash
curl -sS -o /dev/null -w 'root %{http_code} %{redirect_url}\n' https://paperdeck.michaelpiccirilli.it/
curl -sS -o /dev/null -w 'feed %{http_code} %{redirect_url}\n' \
  -H 'User-Agent: Mozilla/5.0' \
  -H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' \
  https://paperdeck.michaelpiccirilli.it/feed
curl -sS -o /dev/null -w 'sign-in %{http_code}\n' https://paperdeck.michaelpiccirilli.it/sign-in
curl -sS -o /dev/null -w 'sign-up %{http_code}\n' https://paperdeck.michaelpiccirilli.it/sign-up
```

Expected result:

- `/` redirects to `/feed`.
- `/feed` redirects unauthenticated users to `/sign-in`.
- `/sign-in` and `/sign-up` return `200`.
- Google sign-in redirects authenticated users to `/onboarding` on first sign-up.

## References

- Clerk production deployment: <https://clerk.com/docs/guides/development/deployment/production>
- Clerk Next.js middleware: <https://clerk.com/docs/reference/nextjs/clerk-middleware>
- Vercel environment variables: <https://vercel.com/docs/environment-variables>
