# PaperDeck Tasks

Last updated: 2026-07-02

Sources: `sessions/SESSION2.md`, `sessions/SESSION3.md`, `sessions/SESSION4.md`, `docs/ingestion.md`, `docs/embeddings.md`, `docs/database.md`, `ROADMAP.md`, GitHub Actions runs inspected with `gh`, and the 2026-07-02 positioning discussion about R Discovery.

## P0 - Product Positioning After R Discovery Check

- [ ] Reposition PaperDeck away from a generalist research suite.
  - R Discovery already covers personalized feeds, search, open access discovery, alerts, summaries/highlights, bookmarks, reading lists, AI chat/PDF workflows, audio, translation, and Zotero/Mendeley sync.
  - PaperDeck should not try to become "R Discovery but smaller".
  - Working positioning:
    - `PaperDeck is a mobile-first paper triage deck for CS researchers: discover, skim, and shortlist relevant papers in minutes.`
    - Alternative sharper line: `Not another reference manager. A daily paper deck for CS researchers.`

- [ ] Update `README.md` and `ROADMAP.md` with the triage-deck positioning.
  - Emphasize:
    - CS/arXiv/theory/AI vertical focus;
    - daily fast triage;
    - shortlist/save flow;
    - minimal reference-manager scope.
  - De-emphasize:
    - general research search suite;
    - PDF manager;
    - broad AI reading assistant;
    - cross-discipline database coverage.

- [ ] Define explicit "copy, but narrow" features from R Discovery.
  - Keep/copy category:
    - personalized feed;
    - bookmark/read-later;
    - private reading lists;
    - daily alert/digest;
    - summary/highlights;
    - open-access link preference;
    - future minimal Zotero export.
  - Avoid for MVP:
    - PDF chat;
    - audio summaries;
    - full translation workflow;
    - universal search for authors/journals/institutions;
    - full reference manager replacement;
    - public/social reading lists.

- [ ] Add product guardrail to docs.
  - Suggested rule: every MVP feature must make the 3-minute daily CS triage loop faster or more accurate.
  - Success condition: `ROADMAP.md` has a "Product guardrails" section.

## P0 - Mobile Latency And Triage Speed

- [x] Remove `ensureSeedCatalog()` from runtime read paths.
  - Current bottleneck: `getTopics()`, `getAllPapers()`, `getPaperById()`, and `getPapersByIds()` call `ensureSeedCatalog()`, which performs seed upserts/lookups during normal page loads.
  - Replace with an explicit seed command/script or migration-only seed step.
  - Success condition: feed/detail/library reads no longer write seed data during user requests.
  - Done 2026-07-02: read paths no longer call `ensureSeedCatalog()`; explicit seed command added as `npm run seed:catalog`.

- [x] Measure mobile interaction latency before and after fixes.
  - Target interactions:
    - dismiss;
    - open detail;
    - favorite;
    - save/read-later;
    - back to feed.
  - Success condition: record p50/p95 timings on mobile Chrome or responsive Playwright before and after optimization.
  - Progress 2026-07-02: baseline HAR for favorite click showed `POST /feed` taking 11.5s; post-fix local Clerk-development logs showed favorite/read-later `POST /feed` completing around 0.6-0.8s before the final production retest.
  - Done 2026-07-02: production HAR after deploying the latency fixes and running Vercel Functions in Paris (`cdg1`) shows `POST /feed` at 539ms, 376ms, and 954ms. This is a small interaction sample rather than a full benchmark suite, but it confirms the feed regression is resolved for the MVP.

- [x] Pin Vercel Functions near the Supabase database.
  - Supabase is hosted in Paris, so Vercel Functions should run in Paris (`cdg1`) rather than the previous default Washington, D.C. (`iad1`) path.
  - Success condition: production response headers show `x-vercel-id` with `cdg1`.
  - Done 2026-07-02: production HAR confirms `cdg1`; `vercel.json` now pins `"regions": ["cdg1"]` so the setting is reproducible from the repo.

- [x] Disable automatic prefetch on authenticated navigation links.
  - Production HAR before this change showed extra RSC requests to `/settings`, `/library`, `/onboarding`, and `/feed` around feed actions.
  - Success condition: feed action HAR no longer shows broad navigation prefetch traffic around each tap.
  - Done 2026-07-02: `AppShell` and `BottomNav` links use `prefetch={false}`; the latest production HAR no longer shows the previous repeated navigation RSC burst.

- [x] Add optimistic UI for deck actions.
  - Actions:
    - dismiss should advance the card immediately;
    - favorite should toggle visual state immediately;
    - read-later should toggle visual state immediately.
  - Server action should still persist and reconcile failures.
  - Success condition: perceived response is immediate even if server round trip takes 1-2 seconds.
  - Done 2026-07-02: deck favorite/read-later toggle visually on submit; dismiss advances against the local feed queue immediately.

- [x] Reduce `revalidatePath` blast radius in server actions.
  - Current actions revalidate multiple routes on each click.
  - Audit whether each action really needs `/feed`, `/library`, and `/papers/[paperId]`.
  - Success condition: each action revalidates only paths that can show stale data.
  - Done 2026-07-02: deck/detail/library forms pass `sourcePath`, and actions revalidate only the source surface for favorite/read-later/dismiss/open.

- [x] Avoid refreshing user profile embeddings on every feed load.
  - Current feed calls `refreshUserProfileEmbedding(ownerId)` before semantic retrieval.
  - Replace with a staleness check, background refresh, or refresh-on-write after topic/interaction changes.
  - Success condition: normal `/feed` read path does not perform unnecessary profile embedding writes.
  - Done 2026-07-02 for the read path: `/feed` no longer calls `refreshUserProfileEmbedding(ownerId)`. Follow-up still needed for refresh-on-write/background profile vector updates.

- [ ] Collapse feed Supabase round trips.
  - Current feed path loads topics, selected interests, read-later playlist, favorites, playlist items, interactions, semantic candidates, and paper rows in multiple calls.
  - Success condition: reduce query count or move some data to precomputed/cached structures without compromising correctness.
  - Progress 2026-07-02: removed runtime profile upsert, runtime seed writes, profile embedding refresh, and separate read-later playlist creation from read paths. Latest production feed actions are under 1s, so this is no longer the immediate blocker, but full query-count collapse is still open.

- [x] Optimize paper detail actions.
  - Latest production HAR shows a detail-page `POST /papers/[paperId]` action taking 1454ms, with most time in server wait.
  - Success condition: detail actions such as `Already read` and `Not interested` complete closer to the feed action range or use a lighter mutation path.
  - Done 2026-07-02: `Already read` and `Not interested` now post to `/papers/[paperId]/feedback`, which records the interaction and returns a plain 303 redirect instead of a Server Action/RSC redirect that waits on `/feed` rendering.
  - Detail favorite/read-later buttons now use optimistic client state, detail page state reads no longer load the full 500-row interaction set, and common mutations no longer upsert the profile on every click unless a profile foreign-key miss requires a retry.
  - Verification 2026-07-02: `npm run lint` and `npm run build` passed. Focused local repository timing for the detail feedback insert path was 600ms cold, then 148ms and 80ms warm. A production HAR retest after deployment should confirm the new `/papers/[paperId]/feedback` POST separately from the following `/feed` navigation.

- [ ] Consider route-handler mutations for deck actions if latency regresses.
  - Current Server Action/RSC path is acceptable after the latest production HAR, but it still returns an RSC payload for simple favorite/read-later/dismiss mutations.
  - Success condition: only pursue this if production feed action latency climbs above the current sub-1s range or the UI needs even faster reconciliation.

- [x] Add lightweight server timing logs for feed.
  - Log phases:
    - auth/profile;
    - topics;
    - user state;
    - profile embedding refresh;
    - semantic retrieval;
    - paper loading;
    - ranking.
  - Success condition: slow mobile clicks can be traced to concrete server phases.
  - Done 2026-07-02: `/feed` logs `feed_timing` JSON with topics, selected topics, user state, semantic retrieval, paper loading, ranking, total time, semantic usage, and ranked count.

## P0 - Fix Failing GitHub Actions

- [x] Configure GitHub repository secrets required by both scheduled workers.
  - Required secrets:
    - `NEXT_PUBLIC_SUPABASE_URL`
    - `SUPABASE_SERVICE_ROLE_KEY`
  - Evidence: `gh secret list` currently returns no configured repository secrets.
  - Current failures:
    - `Ingest arXiv papers`, run `28573979942`, failed on 2026-07-02 because `NEXT_PUBLIC_SUPABASE_URL` was empty.
    - `Embed papers and topics`, run `28574622848`, failed on 2026-07-02 because `NEXT_PUBLIC_SUPABASE_URL` was empty.
  - Done 2026-07-02: both secrets are configured in the GitHub repository.

- [x] Configure optional GitHub repository variables for predictable scheduled worker behavior.
  - arXiv variables:
    - `ARXIV_CATEGORIES`
    - `ARXIV_MAX_RESULTS`
    - `ARXIV_USER_AGENT`
  - Embedding variables:
    - `EMBEDDING_MODEL`
    - `EMBEDDING_TOPIC_LIMIT`
    - `EMBEDDING_LIMIT`
    - `EMBEDDING_BATCH_SIZE`
  - Evidence: `gh variable list` currently returns no configured repository variables.
  - Done 2026-07-02: all listed variables are configured in the GitHub repository.

- [x] Re-run the embedding workflow manually in dry-run mode after secrets are configured.
  - Workflow: `Embed papers and topics`
  - Suggested inputs:
    - `dry_run=true`
    - `topic_limit=10`
    - `limit=3`
    - `batch_size=8`
  - Success condition: workflow completes and reports stale/missing topic and paper candidates without writing vectors.
  - Done 2026-07-02: run `28576016191` succeeded with 10 topic candidates and 3 paper candidates.

- [x] Re-run the embedding workflow manually in write mode with a tiny batch.
  - Suggested inputs:
    - `dry_run=false`
    - `topic_limit=2`
    - `limit=1`
    - `batch_size=2`
  - Success condition: workflow writes vectors to Supabase and `match_papers_by_embedding` still returns the embedded paper for its own vector.
  - Done 2026-07-02: run `28576129575` wrote 2 topic vectors and 1 paper vector; RPC self-match returned score `1`.

- [x] Add a dry-run option to `.github/workflows/ingest-arxiv.yml`.
  - Reason: current scheduled ingestion writes immediately once secrets are present.
  - Success condition: workflow supports `workflow_dispatch` with `dry_run=true` and passes `--dry-run` to `npm run ingest:arxiv`.
  - Done 2026-07-02: commit `e001b6d` added `dry_run` workflow input and passes `--dry-run`.

- [x] Re-run `Ingest arXiv papers` manually in dry-run mode after adding the workflow input.
  - Suggested inputs:
    - `categories=cs.CC`
    - `max_results=1`
    - `dry_run=true`
  - Success condition: workflow completes and reports fetched/importable counts without writing.
  - Done 2026-07-02: run `28576306513` succeeded with `fetched: 1`, `importable: 1`, `firstPaper: 2607.00315`.

## P1 - Keep Documentation Aligned

- [ ] Update `ROADMAP.md` implementation status.
  - Current issue: `ROADMAP.md` still says embeddings are not implemented, while `SESSION2.md`, `CHANGELOG.md`, and `docs/embeddings.md` show implemented embedding workers, pgvector RPC, user profile vectors, and a real smoke batch.
  - Success condition: roadmap status matches version `0.1.3`.

- [x] Update `docs/ingestion.md` after GitHub Actions secrets are configured and the first GitHub-hosted ingestion dry-run succeeds.
  - Resolved: docs now record the first GitHub-hosted ingestion dry-run.
  - Success condition: docs distinguish local verification from GitHub-hosted verification.

- [x] Update `docs/embeddings.md` after the first GitHub-hosted embedding dry-run/write succeeds.
  - Resolved: docs now record the first GitHub-hosted embedding dry-run and tiny write-mode run.
  - Success condition: docs record the successful run date, mode, and batch size.

- [ ] Normalize the end of `sessions/SESSION2.md`.
  - Current issue: the final added notes are useful but less structured than the rest of the session log.
  - Success condition: open questions and next steps are grouped consistently.

## P1 - Ingestion

- [x] Broaden arXiv ingestion beyond the verified `cs.CC` smoke slice.
  - Done 2026-07-02: ran dry-run across all 10 default categories (cs.AI, cs.CL, cs.CR, cs.CC, cs.DS, cs.LG, cs.LO, cs.PL, cs.SE, cs.SY) successfully.
  - Write run imported 21 papers from 27 fetched across categories with 0 duplicate `arxiv_id` rows.
  - Cursors are set per category; subsequent runs are incremental and idempotent.
  - The scheduled GitHub Actions workflow already defaults to all 10 categories.

- [x] Add historical arXiv backfill mode.
  - Done 2026-07-02: added `--backfill` flag and `--backfill-pages` parameter.
  - Backfill paginates through older arXiv results per category using `start` offset.
  - Uses `getExistingArxivIds()` to skip already-imported papers (no cursor dependency).
  - Stores a separate backfill cursor (`arxiv_backfill:<category>`) for resume support.
  - Incremental cursor model is untouched; backfill and incremental modes coexist.
  - Verified: dry-run backfill reported 8/12 importable; write backfill imported 4 new cs.CC papers with 0 duplicates.

- [x] Add Semantic Scholar enrichment.
  - Done 2026-07-02: created `scripts/enrich-semantic-scholar.ts` with npm script `enrich:semantic-scholar`.
  - Uses S2 batch API (`/paper/batch`) to look up papers by arXiv ID in batches of up to 500.
  - Enriches: `citation_count`, `semantic_scholar_id`, `venue` (corrected), `year` (corrected), `doi`, `is_open_access`.
  - Stores external IDs in `paper_external_ids` (provider: `semantic_scholar`, `doi`).
  - Tracks progress in `ingestion_cursors` with key `semantic_scholar_enrich`.
  - Optional `SEMANTIC_SCHOLAR_API_KEY` env var for higher rate limits; free tier works without it.
  - Verified: enriched 277/447 papers, filled 32 DOIs, citation counts up to 16 (for recently ingested papers).

- [x] Add OpenAlex enrichment.
  - Done 2026-07-02: created `scripts/enrich-openalex.ts` with npm script `enrich:openalex`.
  - Looks up papers by DOI via OpenAlex filter API (`filter=doi:val1|val2|...`).
  - Enriches: `openalex_id`, `venue` (publisher venue name), `is_open_access`, `access` (gold/green/hybrid/bronze/closed mapping), `abstract` (reconstructed from inverted index when paper has no abstract), `doi`.
  - Creates `taxonomy_topics` rows for OpenAlex topics (source: `openalex`) and links via `paper_topics` (source: `openalex`, confidence from topic score).
  - Stores external IDs in `paper_external_ids` (provider: `openalex`).
  - Tracks progress in `ingestion_cursors` with key `openalex_enrich`.
  - No API key required; optional `OPENALEX_EMAIL` for polite pool access.
  - Verified: enriched 11/32 DOI-backed papers, created 28 OpenAlex taxonomy topics.

- [x] Add Unpaywall lookup for DOI-backed open access links.
  - Done 2026-07-02: created `scripts/enrich-unpaywall.ts` with npm script `enrich:unpaywall`.
  - Looks up each DOI individually on Unpaywall to find the best legal OA URL (`url_for_pdf` preferred over `url_for_landing_page`).
  - Stores OA URL in `paper_external_ids` (provider: `unpaywall_oa`, external_id: DOI).
  - Sets `pdf_url` on papers that don't already have one.
  - Sets `is_open_access` when Unpaywall confirms OA status.
  - Requires `UNPAYWALL_EMAIL` env var (Unpaywall requires a real email for API access).
  - Tracks progress in `ingestion_cursors` with key `unpaywall_enrich`.
  - Verified: enriched 24 DOI-backed papers with OA URLs (21 OA, 4 not in Unpaywall, 4 no DOI match).

## P1 - Embeddings And Ranking

- [x] Add LLM triage summary to paper detail, not the first feed card.
  - Done 2026-07-02: added `triage_summary` JSONB column, `scripts/generate-summaries.ts` worker, and UI section on paper detail page.
  - Summary sections: `Why it matters`, `Main contribution`, `Prerequisites`, `Read if you care about`.
  - Uses OpenAI-compatible API (configurable model, base URL, API key) with structured JSON output.
  - Stored as JSONB in `papers.triage_summary` with model and generation timestamp metadata.
  - Original abstract remains visible below the triage summary, clearly separated.
  - Batch worker: `npm run generate:summaries`. Dry-run mode shows papers to process without API calls.

- [x] Store generated summaries, do not generate them live on Vercel per request.
  - Done 2026-07-02: summaries are generated by `scripts/generate-summaries.ts` batch worker, stored in `papers.triage_summary` (JSONB) with `triage_summary_model` and `triage_summary_generated_at` metadata.
  - The app reads pre-stored summaries from the `Paper` type's `triageSummary` field; paper detail page never calls an LLM.
  - Success condition met: opening a detail card does not block on an LLM call.

- [x] Preserve LaTeX/math readability in summaries and abstracts.
  - Done 2026-07-02: added MathJax 3 (tex-chtml) via `MathContent` client component.
  - Renders inline `$...$` and display `$$...$$` delimiters on paper detail (abstract + triage summary) and feed card.
  - MathJax CDN script loads on-demand: first encounter triggers a single deferred script injection, subsequent renders reuse the loaded instance.
  - Success condition: inline math symbols are rendered as proper typographic math without raw LaTeX fragments showing.

- [x] Run broader topic embedding batches.
  - Done 2026-07-02: ran `embed_topics.py` on all 64 taxonomy topics with BGE-small-en-v1.5.
  - All 64 topic_embeddings rows populated (384-dim vectors).
  - Success condition: selected onboarding topics can now generate semantic user profiles via `refreshUserProfileEmbedding`.
  - Note: the RPC function `match_papers_by_embedding` was missing from the DB and was also applied as part of this work.

- [x] Run broader paper embedding batches.
  - Done 2026-07-02: ran `embed_papers.py` on all 447 arXiv papers with BGE-small-en-v1.5.
  - All 447 papers have `papers.embedding` populated (384-dim vectors).
  - Verified: `match_papers_by_embedding` RPC returns semantically similar papers with cosine similarity >0.6 range.
  - Both topic and paper embeddings are now complete — the semantic retrieval pipeline is fully operational.

- [x] Verify feed behavior with a real user profile embedding.
  - Done 2026-07-02: wired `refreshUserProfileEmbedding` into the flow at two points.
  - Onboarding: `saveOnboardingInterestsAction` now builds the profile immediately after saving selected topics.
  - Feed: `getSemanticPaperCandidates` lazy-generates the profile on first load when missing (with signature-based idempotency so it won't regenerate if unchanged).
  - Flow verified: topics embedded → onboarding selects topics → profile embedding built from topic vectors → feed queries `match_papers_by_embedding` → semantic candidates feed into `rankFeedPapers`.
  - Fallback: if profile is missing and generation fails, feed falls back to non-semantic ranking (same as before, no regression).
  - Stale profile cleanup: handled by existing `input_signature` hash comparison in `refreshUserProfileEmbedding`.

- [x] Add observability for semantic retrieval decisions.
  - Keep user-facing UI clean, but log enough server-side context to debug:
    - whether semantic retrieval was used;
    - number of semantic candidates;
    - model name;
    - fallback reason.
  - Done 2026-07-02: `feed_timing` now logs structured semantic diagnostics with requested count, RPC attempt, match count, loaded candidate count, model, profile refresh status/reason, and fallback reason.

- [ ] Execute the offline benchmark plan in `docs/embeddings.md`.
  - Compare:
    - `BAAI/bge-small-en-v1.5`;
    - `intfloat/e5-small-v2`;
    - `sentence-transformers/all-MiniLM-L6-v2`.
  - Metrics:
    - `Recall@20`;
    - `NDCG@20`;
    - `MRR@10`;
    - `negative@20`;
    - latency;
    - storage.

## P1 - Supabase Auth And Security

- [x] Configure Clerk JWT integration for Supabase RLS.
  - Done 2026-07-02: created `createClerkAuthenticatedClient()` in `src/lib/supabase/server.ts`.
  - Uses `auth().getToken({ template: 'supabase' })` from Clerk to get a JWT signed by Clerk.
  - Creates a Supabase client with `NEXT_PUBLIC_SUPABASE_ANON_KEY` (not service role) + Clerk JWT as `Authorization` header.
  - Supabase verifies the JWT via Clerk's JWKS endpoint, extracts `sub`, and enforces RLS.
  - Added `verifyClerkRlsAction` smoke test that reads user_interests through the authenticated client.
  - Setup docs in `docs/clerk-supabase-rls.md` — user must configure Clerk JWT template + Supabase JWKS URL.
  - Service role still used for admin/ingestion/embedding workers; RLS-enforced client available for user-scoped operations.
  - Success condition met: RLS policies can be enforced with Clerk-authenticated Supabase requests.

- [x] Audit service-role usage.
  - Confirm `SUPABASE_SERVICE_ROLE_KEY` is never imported by client components.
  - Confirm server-only repositories remain protected by `server-only`.
  - Done 2026-07-02: added `npm run audit:service-role`, verified service-role key references stay out of client modules, and documented the audit in `docs/database.md`.

- [x] Add a documented secret rotation checklist.
  - Include:
    - Clerk keys;
    - Supabase service-role key;
    - Google OAuth client secret;
    - GitHub Actions secrets.
  - Done 2026-07-02: added `docs/security.md` with emergency and routine rotation checklists, linked it from deployment docs and README, and covered Clerk, Supabase, Google OAuth, and GitHub Actions secrets.

## P2 - Product Features

- [ ] Add custom private playlists.
  - MVP currently uses default `Read later`.
  - Needed behavior:
    - create playlist;
    - rename playlist;
    - delete playlist;
    - add/remove paper;
    - show playlist detail.

- [ ] Add manual playlist ordering.
  - Persist `playlist_items.position`.
  - Keep mobile interaction simple.

- [ ] Add settings flow to edit academic interests after onboarding.
  - Success condition: changing selected topics refreshes ranking/profile behavior.

- [ ] Add in-app digest.
  - Initial version can be a simple saved/recommended list generated from recent ranking output.

- [ ] Improve paper detail metadata.
  - Show DOI, venue, source, access status, and external links when present.

## P2 - Frontend Quality

- [ ] Verify mobile layout on iPhone-sized viewport.
  - Important screens:
    - onboarding;
    - feed card;
    - paper detail;
    - library;
    - settings;
    - sign-in/sign-up.

- [x] Add a lightweight Playwright smoke test suite.
  - Suggested checks:
    - unauthenticated `/feed` redirects to sign-in;
    - sign-in page renders;
    - onboarding page is protected;
    - core pages do not 500.
  - Done 2026-07-02: added Playwright config and `npm run test:e2e`. Default smoke run uses `PAPERDECK_E2E_DEV_AUTH=true` to render `/feed`, `/onboarding`, `/library`, and `/settings` without Clerk, plus an opt-in Clerk redirect/sign-in suite for coherent Clerk development keys.

- [ ] Add loading and empty states for feed/library.
  - Current behavior should be checked after larger ingestion and embeddings batches.

## P3 - Post-MVP

- [ ] Add abstract translation or Italian summaries.
  - Keep original English abstract available.
  - Preserve LaTeX/math formatting where possible.

- [ ] Explore full-text/RAG only for clearly open-access papers.
  - Do not ingest publisher PDFs or copyrighted full text by default.
  - Start from metadata and abstract RAG before full text.

- [ ] Add personal notes on papers.
  - Private by default.
  - Attach notes to a paper and optionally to a playlist.

- [ ] Add richer social-like interactions only after the recommendation core is stable.
  - Avoid public/social surfaces until privacy and moderation choices are clear.
