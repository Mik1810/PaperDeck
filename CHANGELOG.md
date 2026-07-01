# Changelog

All notable changes to this project will be documented in this file.

This project follows Semantic Versioning.

## [0.0.0] - 2026-07-01

### Added

- Next.js scaffold with TypeScript, App Router, Tailwind, and ESLint.
- Initial PaperDeck app shell replacing the default Next.js starter screen.
- Route skeleton for feed, onboarding, library, settings, and paper detail views.
- Shared UI components for the app shell, bottom navigation, paper cards, and paper list items.
- Mock paper, topic, playlist, and user interest data.
- TypeScript domain types for papers, topics, playlists, and interactions.
- Clerk SDK integration with provider, protected app routes, auth pages, and `.env.example`.
- Optional Clerk `authorizedParties` middleware configuration for production origin checks.
- Supabase database plan and initial SQL schema with pgvector, ownership columns, indexes, and future RLS policies.
- Initial Supabase schema applied and verified against the PaperDeck Supabase project.
- Deployment notes for Vercel and the Clerk production-key requirement.
- Custom domain deployment at `paperdeck.michaelpiccirilli.it` verified with Clerk production keys.
- Clerk production DNS records and SSL certificates verified for the custom domain.
- Initial product roadmap for PaperDeck.
- Public README with project description, MVP scope, planned data sources, ranking approach, and architecture.
- SVG logo under `logo/paperdeck-logo.svg`.
- Session log folder with `sessions/SESSION1.md`.
- Agent guidance in `AGENT.md`.

### Notes

- Version `0.0.0` represents product definition, repository setup, and initial scaffold only.
