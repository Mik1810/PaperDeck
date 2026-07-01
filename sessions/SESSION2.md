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

MVP persistence now has a first server-side implementation:

- installed `@supabase/supabase-js`;
- added a server-only Supabase service-role client;
- added Clerk session helper that maps authenticated users to `owner_id`;
- added catalog repository that seeds the initial topic/paper mock data into Supabase;
- added user-data repository for profiles, onboarding interests, favorites, `Read later`, playlist items, and user-paper interactions;
- added server actions for onboarding, dismiss, open detail, favorite, and save to `Read later`;
- connected `/feed`, `/onboarding`, `/library`, `/settings`, and `/papers/[paperId]` to Supabase-backed data instead of static mock state;
- made the onboarding topic picker interactive and persisted via server action;
- added `src/lib/ranking/feed-ranking.ts` for MVP feed ranking from selected topics, hierarchical topic affinity, recent paper feedback, citation/year metadata, and seen-paper penalties;
- made `open_detail` hide the opened paper from the active deck so the feed advances after the user opens a paper;
- kept `SUPABASE_SERVICE_ROLE_KEY` server-only.
- verified the catalog repository against the remote Supabase project and seeded 10 topics plus 4 starter papers.

Validation after the persistence work:

```text
npm run lint  -> passed
npm run build -> passed
Remote Supabase seed count -> 10 taxonomy topics, 4 papers
Feed ranking build verification -> passed
```

arXiv ingestion now has a first working implementation:

- installed `fast-xml-parser` and `tsx`;
- added `scripts/ingest-arxiv.ts`;
- added `npm run ingest:arxiv`;
- added `.github/workflows/ingest-arxiv.yml` for daily/manual GitHub Actions import;
- added `docs/ingestion.md`;
- added arXiv worker variables to `.env.example`;
- implemented arXiv Atom parsing, normalized `arxiv_id`, author import, paper-topic linking, external IDs, and `ingestion_runs` tracking;
- added `ingestion_cursors` migration/table and incremental cursor updates per category;
- deduplicated arXiv imports by normalized `arxiv_id` across categories;
- kept the worker focused on metadata/abstract/link import and did not store PDF/full text.

Validation after arXiv ingestion work:

```text
npm run lint -> passed
npm run build -> passed
npm run ingest:arxiv -- --dry-run --categories=cs.CC --max-results=1 -> fetched 1
npm run ingest:arxiv -- --categories=cs.CC --max-results=2 -> imported 2
Remote Supabase count -> 6 total papers, 4 arXiv papers
Latest arXiv ingestion run -> completed, imported_count=2
Applied migration -> ingestion_cursors exists with RLS enabled
Cursor verification -> first cs.CC run imported 1, second cs.CC run imported 0
Cursor dry-run after verification -> fetched 1, importable 0
Cursor DB state after idempotent run -> imported_count=0
```

## Open Questions

- Configure Clerk JWT so Supabase can enforce the prepared RLS policies directly.
- Decide whether local development should switch back to Clerk development keys while keeping live keys only on Vercel Production.
- Configure GitHub repository secrets for the arXiv ingestion workflow:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Add removal from `Read later` and manual playlist ordering.
- Post-feed benchmark for `BAAI/bge-small-en-v1.5` vs `intfloat/e5-small-v2` vs `sentence-transformers/all-MiniLM-L6-v2`.

## Next Suggested Step

Configure the GitHub Actions ingestion secrets, then continue the ingestion worker path:

- broaden arXiv CS imports beyond the verified `cs.CC` smoke test;
- add historical arXiv backfill mode for older result pages;
- enrich imported papers with Semantic Scholar/OpenAlex metadata;
- generate BGE-small embeddings offline;
- replace the current topic/feedback ranking with embedding-aware ranking.
