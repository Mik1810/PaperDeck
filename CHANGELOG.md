# Changelog

All notable changes to this project will be documented in this file.

This project follows Semantic Versioning.

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
