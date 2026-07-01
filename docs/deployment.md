# Deployment Notes

## Current Deployment

- Public URL: <https://paper-deck-ecru.vercel.app/>
- Platform: Vercel
- Checked on: 2026-07-01

Smoke-test result:

- `/` returns `307` and redirects to `/feed`.
- `/sign-in` returns `200`.
- `/sign-up` returns `200`.
- `/feed` returns `404` for an unauthenticated command-line request because Clerk rewrites protected routes when the deployment uses development Clerk keys on a public domain.

The `/feed` route exists in the Next.js app. The observed production response included Clerk headers equivalent to:

```text
x-clerk-auth-status: signed-out
x-clerk-auth-reason: protect-rewrite, dev-browser-missing
x-matched-path: /404
```

This points to Clerk environment setup, not a missing Next.js page.

## Clerk Production Requirement

For a public deployment, Clerk should use a production instance and production keys:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...`
- `CLERK_SECRET_KEY=sk_live_...`

The current Vercel deployment is using development keys (`pk_test_...` / `sk_test_...`). That is fine for local development, but protected routes on a public Vercel domain should be tested with a Clerk production instance before considering the app publicly usable.

Clerk's production deployment guide also requires production OAuth credentials for social login providers. For PaperDeck, that means configuring Google OAuth for the production Clerk instance before launch.

Clerk's production guide also assumes a domain you own and DNS access. If PaperDeck stays on the free `vercel.app` domain for a while, treat it as a development preview until we decide whether to add a custom domain or revisit the auth provider.

## Vercel Environment Variables

Production and Preview should have these values configured in Vercel:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_replace_me
CLERK_SECRET_KEY=sk_live_replace_me
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/feed
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/onboarding

NEXT_PUBLIC_SUPABASE_URL=https://replace-me.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=replace_me
SUPABASE_SERVICE_ROLE_KEY=replace_me_server_only
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` in client-side code.

## Next Smoke Test

After switching Vercel to Clerk production keys and redeploying, re-run:

```bash
curl -sS -o /dev/null -w 'root %{http_code} %{redirect_url}\n' https://paper-deck-ecru.vercel.app/
curl -sS -o /dev/null -w 'feed %{http_code} %{redirect_url}\n' https://paper-deck-ecru.vercel.app/feed
curl -sS -o /dev/null -w 'sign-in %{http_code}\n' https://paper-deck-ecru.vercel.app/sign-in
curl -sS -o /dev/null -w 'sign-up %{http_code}\n' https://paper-deck-ecru.vercel.app/sign-up
```

Expected result:

- `/` redirects to `/feed`.
- `/feed` redirects unauthenticated users to `/sign-in`.
- `/sign-in` and `/sign-up` return `200`.

## References

- Clerk production deployment: <https://clerk.com/docs/guides/development/deployment/production>
- Clerk Next.js middleware: <https://clerk.com/docs/reference/nextjs/clerk-middleware>
- Vercel environment variables: <https://vercel.com/docs/environment-variables>
