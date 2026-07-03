# Changelog

All notable changes to this project will be documented in this file.

This project follows Semantic Versioning.

## [Unreleased]

### Added

- App CI workflow for service-role audit, lint, build, and Playwright smoke tests on pull requests and pushes to `main`.
- Unit test script for focused repository regression tests.
- Regression tests for playlist item add, remove, and reorder ownership checks.
- Source display mapping and badges for Crossref, manual, and unknown paper sources.
- Unit tests for database-to-display paper source mapping.
- Python summary generation script (`scripts/generate_summaries.py`) using Gemini via `uv`.
- Generated Supabase database types with repeatable generation and stale-check commands.
- GitHub Actions check for stale generated database types.

### Fixed

- Unit test command now resolves `server-only` repository imports through the React server condition.
- Playlist item add, remove, and reorder mutations now verify playlist ownership before writing through the service-role Supabase client.
- Manual paper records no longer display as arXiv sources.
- Summary generation retry delay capped to 300s to prevent hours-long waits on 429 responses from GitHub Models.
- Repository queries now use generated Supabase table types instead of broad manual row casts.

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
