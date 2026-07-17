# Changelog

All notable changes to this project will be documented in this file.

This project follows Semantic Versioning.

## [Unreleased]

### Added

- Added private mutual friendships with transactional requests, crossed-request auto-acceptance, 30-day decline cooldowns, daily rate limits, cancel/unfriend flows, directional blocks, connection management UI, and ranking-isolation tests.
- Added collaboration identities with an explicit public display name, exact-email HMAC discovery, opt-out visibility, group invitation preferences, a ten-per-minute lookup limit, Clerk email-change synchronization, and RLS isolation tests.
- Added deterministic A/B/anonymous Supabase RLS isolation tests as the first security gate for cross-user collaboration.
- Added an automated live A/B smoke test that creates and revokes temporary Clerk sessions and verifies Supabase RLS without manual JWT handling.
- Moved Clerk RLS test-user email identifiers out of source control and into required local environment configuration.
- Refined the post-MVP social plan around private research groups, mutual friendships, exact-email discovery with opt-out, deterministic ownership succession, durable realtime-assisted notifications, paper activity events, and a separately gated future group chat.
- Added a versioned end-to-end social-interactions development plan: recommendation gates, privacy/ACL foundations, metadata sharing, private academic subscriptions, invite-only collections, moderation, and explicit public-release gates.
- Added a Zod validation layer (`src/lib/schemas/*`) and replaced unsafe `as` casts with `.parse()` in semantic retrieval and the ingest/enrich scripts.
- Added a catalog search page at `/search` and replaced the redundant `Topics` navigation item with `Search`.
- Added Prev/Next pagination to `/search` (20 results per page) with URL-driven `page` params.
- Added an in-app `/digest` page ("New for you"): a scannable, topic-grouped list of the 10 most relevant recent papers (last 7 days, widening to 14/30 when sparse), distinct from the swipe-based feed. Added a Digest nav item and moved mobile Settings access to a header gear icon.
- Added private per-paper notes on the paper detail page (`paper_notes` table, timestamped sequential note log per paper, optional playlist link), with add/delete server actions and RLS.
- Improved paper detail metadata: added a compact Details section (source, access status, venue, year, citations, DOI) shown only when present.

### Fixed

- Moved the mobile PWA update prompt below the header so it no longer blocks bottom navigation, feed actions, or settings controls.
- Ensured legacy accounts synchronize a public collaboration identity before sending a friend request, preventing requests that could not be rendered in the recipient's Connections inbox.
- Hardened scientific-text rendering for common arXiv LaTeX delimiters (`\\(...\\)`, `\\[...\\]`, `$...$`, and `$$...$$`), escaped dollars, and unbalanced delimiters without weakening HTML escaping.
- Made settings interest edits explicit and recoverable: changes remain local until saved, concurrent toggles are blocked during persistence, failures restore the last confirmed selection, and users see an actionable error.
- Centralized authenticated navigation links with prefetch disabled by default, preventing background RSC requests from dynamic user-specific routes.
- Feed cards now receive real recommendation impression IDs, so their dismiss, favorite, Read later, and open-detail actions retain ranking attribution.
- `Already read` now contributes the same positive feedback weight as `read` to both feed ranking and the user profile embedding.
- Fixed `npm run issues:import` creating issues with a literal `-` body: the script now uses `gh --body-file -` (piped stdin) instead of `--body -`.
- Swipe-right save-to-Read-later now awaits the mutation and rolls back the card on failure, matching the dismiss path (no more silent data loss).
- Wrapped `saveSelectedTopics` (delete + insert + profile update) in a transaction so interrupted onboarding can no longer wipe interests.
- Made playlist reordering atomic and batched (single `CASE` update) and fixed the next-position race on add via a `FOR UPDATE` lock.
- Scoped per-paper note deletion to its paper, not just owner + note id.
- Made favorites and Read later ordering deterministic (favorites by newest; Read later by added date as a stable tie-breaker).
- Stopped fabricating the current year for papers with a missing year; `year` is now optional and hidden in the UI when absent.
- Generalized the misleading `requirePaperId` form helper to `requireFormId(field)` and renamed the playlist hidden inputs to `playlistId`.
- Removed the N+1 playlist-item queries on the library page (single batched query).
- Scheduled the paper summary workflow twice daily (05:37 and 17:37 UTC) so summary generation keeps pace with nightly arXiv ingestion.
- Fixed the arXiv ingestion workflow `Summary` step failing with `jq: Cannot iterate over string` (exit 5) by rewriting the summary formatter in Python; ingestion itself was succeeding but the run was marked failed.
- Reduced `/feed` refresh cost by reusing the already-loaded feed state, caching short-lived live recommendation batches, and clearing cached feed batches when interests change.
- Reduced favorite and Read later deck mutation round trips by replacing preflight SELECTs with insert-on-conflict toggle flows.
- Kept the mobile feed card action row and `Read online` link above the bottom navigation.
- Simplified the feed sidebar by removing Mix, expanding Up next to five papers, matching its height to the main card, replacing the header `PD` block with the app mark, replacing feed green/blue accents with onboarding teal, hiding the feed card venue/category line, and tightening vertical spacing so the feed card leaves bottom margin.
- Aligned stale unit tests with the current 50-paper feed batch, `paperdeck-initial-feed-v2`, five-minute batch TTL, classic bonus, and feed-hidden favorite/save behavior.

## [0.1.5] - 2026-07-06

### Added

- Feed deck now loads more papers when the queue drops below 3 visible cards.
- Swipe gestures with card stacking, visual affordances (✕ dismiss, Bookmark save), and exit animations.
- Triage-deck product positioning and guardrails in README.md and ROADMAP.md.
- Markdown-to-GitHub-issues importer (`npm run issues:import`).
- Repository boundary audit: all 36 repository functions tagged `@user-scoped` or `@admin`.
- `owner-guard.ts` utility for defense-in-depth owner id validation.
- `enrich-missing-abstracts.ts`: backfills paper abstracts from arXiv, Semantic Scholar, and OpenAlex.
- `import-paraphrased-abstracts.ts`: imports manually curated paper descriptions from JSON.
- Cover image for onboarding wizard.
- Security headers in `next.config.ts` (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy).
- Concurrency groups on all 5 GitHub Actions workflows.
- `$$...$$` display math support in KaTeX renderer.
- `typecheck` and `test` npm scripts.
- Recommendation impressions table and feed instrumentation.
- Authorization and mutation regression tests (40 unit tests, E2E mutations spec).

### Fixed

- `profiles_select_own` and `profiles_update_own` RLS policies now have proper `using`/`withCheck` clauses.
- Deck API error messages no longer leak internal details in production.
- External paper links use `rel="noreferrer noopener"`.
- Feed deck PaperCard/PlaylistPapers keys include state to force remount on prop changes.
- Playlist creation form stays visible until server action succeeds (race condition fix).
- Embedding model aligned across SQL function, TypeScript constant, and ROADMAP (all MiniLM).
- `user_paper_interactions` now has unique constraint on `(owner_id, paper_id, action)`.
- Playlist navigation uses Next.js `<Link>` instead of full-page `<a>`.
- Playwright mobile viewport project added (skipped in CI to avoid DB race).
- Profile embedding refreshed asynchronously after every deck/feedback mutation via `after()`.
- arXiv ingestion hardened with retry/backoff (429/5xx), cursor tie-breaking by arxiv_id.
- Classic paper discovery now prefers papers with abstracts (requests 3x, sorts abstract-first).
- All 633 catalog papers now have abstracts (23 recovered from APIs, 9 imported as paraphrased).
- CI workflows now write structured markdown job summaries.
- `aria-label` moved from icons to their wrapping buttons.
- `paperFromRow` no longer falsely marked `async`.
- `tsconfig.json` target raised to ES2020.
- Database connection pool default raised to 3.
- `poweredByHeader` disabled.

### Removed

- 7 classic papers without abstracts (all books/treatises with no retrievable abstract).

## [0.1.4] - 2026-07-02

### Added

- Custom private playlists with create, rename, delete, and add/remove paper support.
- Drag-and-drop playlist paper ordering via @dnd-kit with optimistic reorder.
- API route `POST /api/deck` for lightweight deck mutations (dismiss, favorite, read_later).
- Secret rotation checklist for Clerk, Supabase service-role credentials, Google OAuth, and GitHub Actions secrets.
- Repeatable service-role audit command to verify server-only Supabase access boundaries.
- Lightweight Playwright smoke test suite for core authenticated routes under local dev auth.
- Structured feed logs for semantic retrieval decisions, candidate counts, model name, and fallback reason.
- Architecture diagrams covering runtime flow, batch workers, data model, security boundaries, and ranking inputs.
- Multi-category arXiv ingestion verified across all 10 default CS categories (447 papers, 0 duplicates).
- Historical arXiv backfill mode with `--backfill` and `--backfill-pages` flags.
- Separate backfill cursors (`arxiv_backfill:<category>`) for resume support.
- Semantic Scholar enrichment script (`scripts/enrich-semantic-scholar.ts`): citation counts, venue corrections, DOIs, and S2 IDs for 277 papers.
- OpenAlex enrichment script (`scripts/enrich-openalex.ts`): venue, open access status, topics, and abstracts for 11 DOI-backed papers.
- Unpaywall enrichment script (`scripts/enrich-unpaywall.ts`): legal OA URLs stored for 21 papers.
- New npm scripts: `enrich:semantic-scholar`, `enrich:openalex`, `enrich:unpaywall`.
- New environment variables for enrichment workers in `.env.example`.
- OpenAlex taxonomy topics (28 created) linked via `paper_topics` with confidence scores.

### Changed

- Normalized embedding documentation, roadmap status, schema comments, semantic retrieval filtering, remote embedding rows, and GitHub Actions cache naming around the MiniLM model decision.
- ROADMAP.md implementation status updated to reflect completed ingestion and enrichment pipeline.
- docs/ingestion.md expanded with backfill mode and all three enrichment worker sections.
- TASKS.md #10-#14 marked as completed.

## [0.1.3] - 2026-07-01

### Added

- First real BGE-small embedding smoke batch written to Supabase: 2 topic vectors and 1 paper vector.
- Verification notes for the local `uv run --with-requirements requirements-embeddings.txt` embedding path.
- Offline embedding benchmark plan for BGE-small, E5-small-v2, and MiniLM.

### Changed

- Project package version advanced from `0.1.2` to `0.1.3`.
- Embedding documentation updated with the first real batch result and model comparison plan.

## [0.1.2] - 2026-07-01

### Added

- Topic embedding worker with Supabase REST candidate selection, dry-run mode, and `topic_embeddings` upserts.
- Shared Python embedding worker utilities for Supabase REST access, hashing, vector formatting, and model loading.
- GitHub Actions embedding workflow step for topic vectors before paper vectors.

### Changed

- Project package version advanced from `0.1.1` to `0.1.2`.
- Embedding documentation updated to describe topic embedding generation and dry-run commands.

## [0.1.1] - 2026-07-01

### Added

- Server-side user profile embedding aggregation from stored topic and paper vectors.
- Feed refresh of stored user profile embeddings before pgvector semantic retrieval.
- Stale user profile embedding cleanup when no current source vectors are available.

### Changed

- Project package version advanced from `0.1.0` to `0.1.1`.
- README and embedding/database docs updated with the current semantic retrieval implementation status.

## [0.1.0] - 2026-07-01

### Added

- Production deployment on `paperdeck.michaelpiccirilli.it`.
- Clerk production setup with custom domain DNS, SSL, and Google OAuth login.
- Supabase service-role server client and repository layer for MVP persistence.
- Seed catalog persistence for initial topics and starter papers.
- Persistent onboarding interests, favorites, default `Read later`, playlist items, and paper interactions.
- Feed, library, settings, and paper detail pages wired to server-side Supabase data.
- MVP feed ranking from selected topics, hierarchical topic affinity, recent feedback, and seen-paper penalties.
- Toggle behavior for the default `Read later` playlist from feed/detail pages.
- Library removal action for `Read later` items.
- Paper detail actions for `Already read` and `Not interested` ranking signals.
- arXiv ingestion script and GitHub Actions workflow for daily/manual metadata import.
- Incremental arXiv category cursors stored in Supabase.
- arXiv import deduplication by normalized arXiv ID across categories.
- Ingestion documentation with required secrets, local dry-run command, and arXiv API constraints.
- Embedding and ranked retrieval workflow specification in `docs/embeddings.md`.
- Embedding schema migration, Python embedding worker dry-run, and GitHub Actions embedding workflow.
- pgvector paper matching RPC and feed-side semantic candidate fallback.

### Changed

- Project package version advanced from `0.0.0` to `0.1.0`.
- README updated to reflect the current MVP foundation instead of only the initial scaffold.

## [0.0.0] - 2026-07-01

### Added

- Initial product roadmap for PaperDeck.
- Public README with project description, MVP scope, planned data sources, ranking approach, and architecture.
- SVG logo under `logo/paperdeck-logo.svg`.
- Session log folder with `sessions/SESSION1.md`.
- Agent guidance in `AGENT.md`.
- Next.js scaffold with TypeScript, App Router, Tailwind, and ESLint.
- Initial PaperDeck app shell replacing the default Next.js starter screen.
- Route skeleton for feed, onboarding, library, settings, and paper detail views.
- Shared UI components for the app shell, bottom navigation, paper cards, and paper list items.
- Mock paper, topic, playlist, and user interest data.
- TypeScript domain types for papers, topics, playlists, and interactions.
- Clerk SDK integration with provider, protected app routes, auth pages, and `.env.example`.
- Supabase database plan and initial SQL schema with pgvector, ownership columns, indexes, and future RLS policies.
