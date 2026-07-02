# Session 3

Date: 2026-07-02

## Goal

Fix the failing GitHub Actions workers, then start reducing the feed interaction latency reported from Chrome when tapping the deck favorite button.

## Starting Point

At the start of this session:

- `TASKS.md` existed locally as the current task list.
- GitHub repository secrets and variables for scheduled workers were not configured.
- Scheduled runs for `Ingest arXiv papers` and `Embed papers and topics` were failing because `NEXT_PUBLIC_SUPABASE_URL` was empty.
- The arXiv ingestion workflow did not support a manual `dry_run` input.
- Feed reads performed seed writes through `ensureSeedCatalog()`.
- `/feed` refreshed `user_profile_embeddings` on every read.
- Deck actions waited for the Server Action/RSC response before the favorite/read-later visual state changed.
- A HAR capture for a favorite click showed the user-visible delay.

## GitHub Actions Fix

Configured GitHub repository secrets:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Configured GitHub repository variables:

```text
ARXIV_CATEGORIES
ARXIV_MAX_RESULTS
ARXIV_USER_AGENT
EMBEDDING_MODEL
EMBEDDING_TOPIC_LIMIT
EMBEDDING_LIMIT
EMBEDDING_BATCH_SIZE
```

Added a `dry_run` input to `.github/workflows/ingest-arxiv.yml` and pushed:

```text
e001b6d Add arXiv ingestion dry-run workflow input
```

Verified GitHub-hosted worker runs:

```text
Embed papers and topics dry-run
Run: 28576016191
Inputs: dry_run=true, topic_limit=10, limit=3, batch_size=8
Result: success
Output: 10 topic candidates, 3 paper candidates

Embed papers and topics tiny write batch
Run: 28576129575
Inputs: dry_run=false, topic_limit=2, limit=1, batch_size=2
Result: success
Output: 2 topic vectors and 1 paper vector written
RPC check: embedded paper returned as first self-match with semantic_score 1

Ingest arXiv papers dry-run
Run: 28576306513
Commit: e001b6d
Inputs: categories=cs.CC, max_results=1, dry_run=true
Result: success
Output: fetched 1, importable 1, firstPaper 2607.00315
```

## Latency Investigation

The provided HAR file was `click_favorite.har`.

Important timing from the HAR:

```text
POST https://paperdeck.michaelpiccirilli.it/feed
Total: 11519ms
Wait: 2072ms
Receive: 9446ms
Mime: text/x-component

POST https://clerk.paperdeck.michaelpiccirilli.it/v1/client/sessions/.../touch
Total: 299ms
```

Interpretation:

- The large delay was the Server Action/RSC cycle for `POST /feed`, not just Clerk.
- Clerk added visible overhead, but the deck UI was incorrectly waiting for the server response before showing the favorite state.
- Local testing with a Clerk bypass isolates app/UI latency, but does not fully match production. Local testing with Clerk development keys is needed for a production-like auth path on `localhost`.

## Latency Fixes Implemented

Removed runtime seed writes:

- `getTopics()`
- `getAllPapers()`
- `getPaperById()`
- `getPapersByIds()`

Added explicit seed command:

```text
npm run seed:catalog
```

Reduced read-path writes:

- `/feed`, `/library`, `/settings`, and paper detail now use `requireOwnerId()` instead of `requireUserContext()` plus profile upsert.
- Read paths no longer create the `Read later` playlist while rendering.
- `/feed` no longer calls `refreshUserProfileEmbedding(ownerId)` on normal reads.

Added deck optimistic UI:

- Favorite toggles visual state on submit.
- Read-later toggles visual state on submit.
- Dismiss advances immediately using a local queue from the active card plus `Up next`.
- Server actions still persist changes and reconcile through later server refreshes.

Reduced revalidation scope:

- Deck/detail/library forms include `sourcePath`.
- Favorite/read-later/dismiss/open actions revalidate only the source page instead of always revalidating `/feed`, `/library`, and `/papers/[paperId]`.

Added feed timing logs:

```text
event: feed_timing
timings:
  topics
  selected_topics
  user_state
  semantic_retrieval
  paper_loading
  ranking
```

## Local Auth Modes

Added local-only auth bypass:

```env
PAPERDECK_DEV_AUTH=true
PAPERDECK_DEV_OWNER_ID=local-dev-user
```

Rules:

- The bypass only activates when `NODE_ENV !== "production"`.
- Production builds should use `PAPERDECK_DEV_AUTH=false`.
- Production Clerk keys (`pk_live_...` / `sk_live_...`) are valid for the production custom domain, not for `localhost`.
- Local Clerk testing should use Clerk development keys (`pk_test_...` / `sk_test_...`) and `PAPERDECK_DEV_AUTH=false`.

## Documentation Updated

- `TASKS.md`: marked completed GitHub Actions fixes and implemented latency items; left p50/p95 latency measurement open.
- `docs/ingestion.md`: recorded configured secrets/variables and successful GitHub-hosted ingestion dry-run.
- `docs/embeddings.md`: recorded successful GitHub-hosted embedding dry-run/write batch and updated feed profile-refresh behavior.
- `docs/deployment.md`: documented local Clerk development keys and local-only auth bypass.
- `docs/database.md`: documented explicit seed command and no runtime seed writes in catalog reads.
- `README.md`: documented local auth variables and explicit seed command.

## Verification

Local checks:

```text
npm run lint -> passed
npm run build -> passed
npm run seed:catalog -- --dry-run -> passed
```

Local server:

```text
npm run dev -- --hostname 0.0.0.0
http://localhost:3000
```

With `PAPERDECK_DEV_AUTH=true`, `/feed` returns `200` locally and displays a `Local dev` badge instead of loading Clerk.

After switching `.env.local` to Clerk development keys and `PAPERDECK_DEV_AUTH=false`, local dev logs showed the production-like Clerk development path loading successfully. Observed post-fix action timings in local logs:

```text
toggleFavoriteAction POST /feed: about 0.6-0.8s
toggleReadLaterAction POST /feed: about 0.6-0.7s
openPaperAction POST /feed redirect: about 0.5-0.8s
steady-state GET /feed: commonly about 0.3-0.5s
```

These are server log observations, not a formal p50/p95 browser measurement.

## Production Latency Retests

After the local fixes, Vercel Functions were moved to Paris (`cdg1`) to match the Paris Supabase database.

Initial production HAR after the region change still showed slow feed actions:

```text
HAR: har/paperdeck.michaelpiccirilli.it.har
POST /feed: 2241ms, 2126ms, 2067ms, 2697ms
Median: about 2241ms
Header: x-vercel-id included cdg1
Issue: forms were still missing sourcePath=/feed, so production was not yet serving the updated latency code.
```

Two small follow-up changes were made:

- added `vercel.json` with `regions: ["cdg1"]` so the Paris function region is tracked in the repository;
- disabled automatic Next.js prefetch on authenticated navigation links in `AppShell` and `BottomNav`, because the HAR showed repeated RSC prefetches for `/settings`, `/library`, `/onboarding`, and `/feed` around deck actions.

Verification after those changes:

```text
npm run lint -> passed
```

Latest production HAR after deploying the updated code:

```text
HAR: har/paperdeck.michaelpiccirilli.it.har
POST /feed: 539ms, 376ms, 954ms
Median: 539ms
Max: 954ms
sourcePath=/feed: present in all POST /feed forms
Header: x-vercel-id includes cdg1
Page load: onContentLoad about 1442ms, onLoad about 1856ms
```

Interpretation:

- The original production favorite-click regression went from 11.5s to sub-1s feed actions.
- The previous 2.1-2.7s production result was caused by testing an older deployment that lacked the `sourcePath` revalidation change.
- Clerk is not the current feed bottleneck; the latest Clerk session touch in the HAR was about 306ms.
- Navigation prefetch noise is much lower after disabling prefetch on authenticated nav links.
- One remaining slow interaction in the latest HAR is a detail-page `POST /papers/[paperId]` action at 1454ms, likely from `Already read` or `Not interested`.

## Current Status

Completed:

- GitHub worker secrets and variables configured.
- Embedding workflow verified in dry-run and tiny write mode from GitHub.
- Ingestion workflow verified in dry-run mode from GitHub.
- Runtime seed writes removed from catalog reads.
- Feed no longer refreshes profile embeddings on every load.
- Deck favorite/read-later/dismiss interactions are optimistic.
- Revalidation blast radius is reduced.
- Feed timing logs are available.
- Local Clerk production-key error is avoidable with either dev keys or local-only auth bypass.
- Production Vercel Functions run in Paris (`cdg1`) near the Paris Supabase database.
- Feed deck production actions are now under 1s in the latest HAR sample.

Still open:

- If needed, run a larger formal p50/p95 benchmark for the deck interactions.
- Move user profile embedding refresh to refresh-on-write or a background worker.
- Further collapse Supabase query count on `/feed`, though it is no longer the immediate latency blocker.
- Optimize detail-page actions; latest production HAR shows `POST /papers/[paperId]` at 1454ms.
- Consider route-handler/background mutations for simple deck actions only if feed action latency regresses above the current sub-1s range.

## Prompt For Next Session

Use this prompt to continue in a fresh session:

```text
Continue PaperDeck from sessions/SESSION3.md and TASKS.md.

Current state:
- The original production feed favorite latency was 11.5s.
- After removing runtime seed writes/profile embedding refresh, adding optimistic deck UI, reducing revalidatePath scope with sourcePath, pinning Vercel Functions to Paris cdg1, and disabling authenticated nav prefetch, the latest production HAR shows POST /feed at 539ms, 376ms, and 954ms.
- Feed latency is acceptable for the MVP.
- The latest remaining performance issue is detail-page actions: a production HAR showed POST /papers/[paperId] at 1454ms.

Next task:
1. Inspect detail-page actions (`Already read`, `Not interested`, favorite, read-later) and their server path.
2. Reduce detail action latency without broad refactors.
3. Prefer existing patterns unless a route-handler mutation is clearly simpler and safer.
4. Run lint/build or focused verification.
5. Update TASKS.md and the new session notes with measured results.

Be careful with the dirty worktree; do not revert unrelated changes.
```
