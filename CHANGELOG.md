# Changelog

All notable changes to this project will be documented in this file.

This project follows Semantic Versioning.

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
