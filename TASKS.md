# PaperDeck Tasks

Last updated: 2026-07-02

Sources: `sessions/SESSION2.md`, `docs/ingestion.md`, `docs/embeddings.md`, `docs/database.md`, `ROADMAP.md`, GitHub Actions runs inspected with `gh`, and the 2026-07-02 positioning discussion about R Discovery.

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

- [ ] Measure mobile interaction latency before and after fixes.
  - Target interactions:
    - dismiss;
    - open detail;
    - favorite;
    - save/read-later;
    - back to feed.
  - Success condition: record p50/p95 timings on mobile Chrome or responsive Playwright before and after optimization.
  - Progress 2026-07-02: baseline HAR for favorite click showed `POST /feed` taking 11.5s; post-fix local Clerk-development logs show favorite/read-later `POST /feed` completing around 0.6-0.8s, but p50/p95 browser measurements are still pending.

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
  - Progress 2026-07-02: removed runtime profile upsert, runtime seed writes, profile embedding refresh, and separate read-later playlist creation from read paths. Full query-count collapse is still open.

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

- [ ] Broaden arXiv ingestion beyond the verified `cs.CC` smoke slice.
  - Start with a small manual batch per category.
  - Success condition: Supabase has recent papers across the selected CS categories without duplicate `arxiv_id` rows.

- [ ] Add historical arXiv backfill mode.
  - Needed behavior:
    - support paging older result windows;
    - avoid breaking the existing incremental cursor model;
    - keep arXiv rate limit at one request every three seconds.

- [ ] Add Semantic Scholar enrichment.
  - Target fields:
    - citation count;
    - external paper URL;
    - venue/year corrections when useful;
    - Semantic Scholar ID.
  - Keep API-key and rate-limit handling explicit.

- [ ] Add OpenAlex enrichment.
  - Target fields:
    - DOI;
    - venue;
    - open access status;
    - topics;
    - abstract recovery when available and license-safe.

- [ ] Add Unpaywall lookup for DOI-backed open access links.
  - Success condition: paper detail can prefer legal open-access URLs when available.

## P1 - Embeddings And Ranking

- [ ] Add LLM triage summary to paper detail, not the first feed card.
  - Keep the original abstract visible and clearly separate.
  - Suggested sections:
    - `Why it matters`;
    - `Main contribution`;
    - `Prerequisites`;
    - `Read if you care about`.
  - Success condition: summary helps decide whether to read the paper without pretending to replace the abstract.

- [ ] Store generated summaries, do not generate them live on Vercel per request.
  - Preferred flow:
    - batch worker computes summaries for selected/open-access/abstract-only paper metadata;
    - app reads stored summary;
    - summary has model/version/source metadata.
  - Success condition: opening a detail card does not block on an LLM call.

- [ ] Preserve LaTeX/math readability in summaries and abstracts.
  - Success condition: inline math and symbols are not mangled in card/detail views.

- [ ] Run broader topic embedding batches.
  - Suggested first target: all current `taxonomy_topics`.
  - Success condition: selected onboarding topics can generate a semantic user profile even before paper interactions.

- [ ] Run broader paper embedding batches.
  - Suggested first target: all current arXiv + seed papers.
  - Success condition: `papers.embedding is not null` for the current catalog slice.

- [ ] Verify feed behavior with a real user profile embedding.
  - Required checks:
    - selected topic embeddings contribute to `user_profile_embeddings`;
    - semantic candidates appear when vectors exist;
    - fallback ranking still works when vectors are missing;
    - stale profile cleanup still works.

- [ ] Add observability for semantic retrieval decisions.
  - Keep user-facing UI clean, but log enough server-side context to debug:
    - whether semantic retrieval was used;
    - number of semantic candidates;
    - model name;
    - fallback reason.

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

- [ ] Configure Clerk JWT integration for Supabase RLS.
  - Current MVP uses server actions and service-role access on the server.
  - Success condition: prepared RLS policies can be enforced directly with Clerk-authenticated Supabase requests.

- [ ] Audit service-role usage.
  - Confirm `SUPABASE_SERVICE_ROLE_KEY` is never imported by client components.
  - Confirm server-only repositories remain protected by `server-only`.

- [ ] Add a documented secret rotation checklist.
  - Include:
    - Clerk keys;
    - Supabase service-role key;
    - Google OAuth client secret;
    - GitHub Actions secrets.

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

- [ ] Add a lightweight Playwright smoke test suite.
  - Suggested checks:
    - unauthenticated `/feed` redirects to sign-in;
    - sign-in page renders;
    - onboarding page is protected;
    - core pages do not 500.

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
