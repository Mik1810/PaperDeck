# Deployment Notes

## Current Deployment

- Public URL: <https://paperdeck.michaelpiccirilli.it/>
- Vercel preview URL: <https://paper-deck-ecru.vercel.app/>
- Platform: Vercel
- Checked on: 2026-08-04

Smoke-test result:

- `/` returns `307` and redirects to `/onboarding`.
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
NEXT_PUBLIC_PAPERDECK_DEV_AUTH=false
```

Production keys (`pk_live_...` / `sk_live_...`) are tied to the production custom domain and are not valid for `localhost`.

For UI and latency debugging without Clerk, PaperDeck also supports a local-only bypass:

```env
NEXT_PUBLIC_PAPERDECK_DEV_AUTH=true
PAPERDECK_DEV_OWNER_ID=local-dev-user
```

The bypass is ignored in production because it only activates when `NODE_ENV !== "production"`. Use it to isolate application/UI latency from Clerk latency; use Clerk development keys when a local test should resemble the production authentication flow.

## Vercel Environment Variables

Production and Preview should have these values configured in Vercel, with
Clerk credentials scoped differently per environment:

```env
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/feed
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/onboarding
CLERK_AUTHORIZED_PARTIES=https://paperdeck.michaelpiccirilli.it
NEXT_PUBLIC_PAPERDECK_DEV_AUTH=false

NEXT_PUBLIC_SUPABASE_URL=https://replace-me.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=replace_me
SUPABASE_SERVICE_ROLE_KEY=replace_me
DATABASE_URL=postgresql://transaction-pooler-host:6543/postgres
DATABASE_ADMIN_URL=postgresql://session-pooler-host:5432/postgres
DATABASE_MAX_CONNECTIONS=3
DATABASE_STATEMENT_TIMEOUT_MS=15000
DATABASE_QUERY_TIMEOUT_MS=18000
DATABASE_SLOW_QUERY_MS=1000
DATABASE_SLOW_POOL_WAIT_MS=100
LOG_LEVEL=info
```

- Vercel Production uses the Clerk Production pair (`pk_live_...` / `sk_live_...`).
- Vercel Preview deployments on a Vercel-provided `*.vercel.app` host use the
  Clerk Development pair (`pk_test_...` / `sk_test_...`).
- Scope `CLERK_AUTHORIZED_PARTIES` to the intended origins. Do not copy the
  Production-only custom-domain value blindly into Preview.

Never expose `SUPABASE_SERVICE_ROLE_KEY` in client-side code.
The hosted Next.js runtime uses the Supabase Transaction pooler on port `6543`
with `DATABASE_MAX_CONNECTIONS=3` in Vercel Preview and Production.
Node-postgres queues work beyond that application-pool limit. A build-time and
runtime guard rejects a hosted Session-pooler URL, a non-Supabase shared-pooler
host, or a different connection limit without printing the configured URL.
Local development and standard CI intentionally use the isolated Docker
databases described in [`local-database.md`](./local-database.md), rather than
the shared Supabase project.

Drizzle Kit and maintenance scripts prefer `DATABASE_ADMIN_URL`, which uses the
Session pooler on port `5432`; they fall back to `DATABASE_URL` only for
compatibility with environments that have not yet added the administrative
variable. Drizzle uses node-postgres without named prepared statements, and
direct Postgres.js test clients explicitly disable prepared statements, so
Transaction mode remains supported. The application pool retains its
five-second idle and ten-second connection timeouts. Runtime statements have a
15-second PostgreSQL deadline and an 18-second node-postgres fail-safe; the
longer client deadline also frees a pool slot if a proxy does not propagate the
server setting. Queries above one second and pool acquisition waits above 100ms
emit structured diagnostics with an application source frame, duration, and
pool total/idle/waiting counts, but no SQL, connection string, or user data.
Maintenance scripts use their separate administrative connection policy and
explicitly close their one-connection clients, so these runtime deadlines do
not constrain ingestion or migrations. Keep the last Ready
Session-pooler Production deployment recorded as the immediate rollback target.
The Supabase role currently enforces its existing two-minute statement timeout;
lowering that shared setting requires a separate workload audit because
ingestion and maintenance queries use the same database role.

Run the secret-safe, read-only Transaction gate from a configured local
checkout with:

```bash
npm run test:pooler:transaction -- \
  --shape=index --concurrency=12 --iterations=5 \
  --max-connections=3 --deadline-ms=15000
```

The report contains only configuration flags, counts, timings, and sanitized
error classes. It performs no mutations and never reports connection strings,
database identifiers, or user identifiers.
Use `LOG_LEVEL=info` for normal production diagnostics; raise to `debug` only for short investigations and lower to `warn` only if log volume becomes noisy.

`CLERK_AUTHORIZED_PARTIES` is optional while developing, but should be set in production to the final app origin. Use a comma-separated list if more than one origin is intentionally allowed.

Secret rotation procedures live in [`docs/security.md`](./security.md). Use that checklist before deleting old Clerk, Supabase, Google OAuth, or GitHub Actions credentials.

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

- `/` redirects authenticated users with completed onboarding or saved interests to `/feed`; fresh authenticated users go to `/onboarding`.
- `/feed` redirects unauthenticated users to `/sign-in`.
- `/sign-in` and `/sign-up` return `200`.
- Google sign-in redirects fresh users to `/onboarding`; returning users with PaperDeck interests reach `/feed`.

## References

- Clerk production deployment: <https://clerk.com/docs/guides/development/deployment/production>
- Clerk Next.js middleware: <https://clerk.com/docs/reference/nextjs/clerk-middleware>
- Vercel environment variables: <https://vercel.com/docs/environment-variables>
- PaperDeck security operations: [`docs/security.md`](./security.md)
