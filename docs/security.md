# Security Operations

This document keeps PaperDeck's operational security checklists close to the codebase. It describes what to rotate, where each secret is used, and what to verify before deleting old credentials.

## Secret Inventory

| Secret | Primary location | Consumers | Notes |
| --- | --- | --- | --- |
| `CLERK_SECRET_KEY` | Vercel environment variables, `.env.local` for development | Next.js auth middleware, server actions, Clerk backend calls | Secret. Rotate per Clerk environment. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Vercel environment variables, `.env.local` | Browser and server rendering | Public by design; do not treat as incident material by itself. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel environment variables, GitHub Actions secrets, `.env.local` for local server work | Server-only Supabase repositories and batch workers | High risk. Bypasses RLS and must never enter client bundles. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel environment variables, GitHub Actions secrets, `.env.local` | Public Supabase client configuration and workers | Public anon key. Rotate with Supabase key rotation if project policy changes. |
| Google OAuth client secret | Google Auth Platform, Clerk social connection settings | Clerk Google sign-in | Secret. Rotate in Google first, then update Clerk. |
| GitHub Actions secrets | GitHub repository settings | Ingestion, embedding, and summary workflows | Includes `SUPABASE_SERVICE_ROLE_KEY`, optional LLM provider keys, Cloudflare keys, and Jina key. |

Never paste real secret values into GitHub issues, commit messages, logs, docs, screenshots, or session files.

## Emergency Rotation Checklist

Use this when a secret may have leaked.

1. Identify the leaked secret and all consumers.
2. Stop copying or printing the value. Remove it from local shells, temporary files, screenshots, chat, and logs where possible.
3. Create a replacement credential in the owning provider.
4. Update every runtime location before revoking the old credential:
   - Vercel Production and Preview variables;
   - GitHub Actions repository secrets;
   - local `.env.local` files for machines that need continued access;
   - Clerk social connection settings when rotating Google OAuth;
   - any one-off scripts or dashboards using the credential.
5. Redeploy Vercel after changing runtime environment variables. Existing deployments do not automatically receive changed variables.
6. Run the relevant checks:
   - `npm run audit:service-role`;
   - `npm run lint`;
   - `npm run test:e2e`;
   - production sign-in smoke test for Clerk or Google OAuth changes;
   - one dry-run worker for GitHub Actions secret changes.
7. Confirm the new credential is used and the old credential is idle.
8. Revoke or delete the old credential.
9. Inspect provider audit logs for suspicious use during the exposure window.
10. Record the rotation date, affected environments, and verification result in the private operations log, not in this repository if it contains sensitive details.

## Clerk Key Rotation

Rotate `CLERK_SECRET_KEY` if the secret key was exposed, a machine or vendor with access is no longer trusted, or production and development credentials were mixed.

Checklist:

1. Open the correct Clerk app and environment.
2. Create a new Secret Key with a descriptive name such as `vercel-production-YYYY-MM-DD`.
3. Update `CLERK_SECRET_KEY` in Vercel Production and Preview as needed.
4. Update local `.env.local` only on trusted development machines.
5. Redeploy Vercel.
6. Verify:
   - `/sign-in` renders;
   - Google sign-in reaches `/feed` or `/onboarding`;
   - protected routes still redirect unauthenticated users;
   - server actions using Clerk auth still work.
7. Check Clerk key usage metadata if available.
8. Delete the old Secret Key only after the new key is verified.

`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is public by design. Rotate it only when changing Clerk apps/environments or when Clerk dashboard guidance requires it.

## Supabase Service-Role Rotation

Rotate `SUPABASE_SERVICE_ROLE_KEY` if it was exposed, copied to an untrusted place, present in logs, or used from a client bundle.

Checklist:

1. Run `npm run audit:service-role` to confirm the current code path is still server-only.
2. In Supabase, create a replacement secret key or rotate the service-role credential according to the current project key model.
3. Update `SUPABASE_SERVICE_ROLE_KEY` in:
   - Vercel Production and Preview;
   - GitHub Actions repository secrets;
   - trusted local `.env.local` files used for server-side development or one-off maintenance.
4. Redeploy Vercel.
5. Run `npm run audit:service-role`, `npm run lint`, and `npm run test:e2e`.
6. Run a worker dry-run that needs Supabase write credentials, for example ingestion or summary dry-run.
7. Confirm feed/library/settings still load through server repositories.
8. Delete or revoke the old service-role credential only after all consumers use the replacement.
9. Review Supabase logs for suspicious access during the exposure window.

Do not rotate by adding the service-role key to browser-visible variables. `NEXT_PUBLIC_` variables are intentionally exposed to the client bundle.

## Google OAuth Client Secret Rotation

PaperDeck uses Google OAuth through Clerk. Rotate the Google OAuth client secret when it is leaked, when moving between Google Cloud projects, or during scheduled credential hygiene.

Checklist:

1. Open the Google Auth Platform client used by the Clerk production social connection.
2. Add a new client secret when supported, keeping the old secret enabled during rollout.
3. Copy the new secret once and store it in the password manager.
4. Update the Google social connection in Clerk with the new client secret.
5. Verify Google sign-in in production and development environments that use that OAuth client.
6. Confirm the old secret is no longer used.
7. Disable the old secret.
8. After continued successful sign-in, delete the old disabled secret.

If the Google client only supports reset instead of parallel secrets, expect a short outage window: reset the secret, update Clerk immediately, and test sign-in before considering the rotation complete.

## GitHub Actions Secrets Rotation

Current workflows use repository secrets for Supabase and optional provider integrations:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LLM_API_KEY`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_AUTH_TOKEN`
- `JINA_API_KEY`

Checklist:

1. Generate or rotate the secret in its owning provider first.
2. Update the GitHub repository secret through GitHub Settings or with `gh secret set SECRET_NAME`.
3. If the same value is also used by Vercel or local maintenance scripts, update those locations in the same rotation window.
4. Trigger the smallest relevant workflow in dry-run mode where possible:
   - `Ingest arXiv papers` with `dry_run=true`;
   - `Embed papers and topics` with `dry_run=true`;
   - `Generate paper summaries` with `dry_run=true` or a low `limit`.
5. Check the workflow logs for authentication failures and accidental secret printing.
6. Revoke the old provider credential once the workflow succeeds with the replacement.

Prefer GitHub Actions `GITHUB_TOKEN` or OIDC-backed short-lived credentials over long-lived provider secrets when a provider supports that path.

## Rotation Cadence

- Immediate: any suspected exposure, copied secret, leaked `.env`, vendor compromise, or untrusted machine.
- Access change: a collaborator with secret access leaves the project or no longer needs access.
- Scheduled: review all production and workflow secrets at least quarterly.
- Before launch: rotate development/test credentials that were used during setup and confirm production uses only production-scoped keys.

## References

- Clerk: <https://clerk.com/docs/guides/secure/rotate-api-keys>
- Supabase: <https://supabase.com/docs/guides/getting-started/api-keys>
- Google OAuth clients: <https://support.google.com/cloud/answer/15549257>
- Google compromised credentials: <https://docs.cloud.google.com/docs/security/compromised-credentials>
- GitHub Actions secrets: <https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions>
- Vercel environment variables: <https://vercel.com/docs/environment-variables>
