# Agent Guide

This file guides future agent work on PaperDeck.

## Project Purpose

PaperDeck is a mobile-first academic paper discovery app for computer science. The MVP should help a user discover relevant papers through a social-style full-screen deck, save interesting papers, and build private reading lists.

## Current Product Decisions

- Product name: `PaperDeck`.
- Repository name: `paperdeck`.
- App language: user-facing product can start in English; planning conversation may be Italian.
- Domain: computer science only for MVP.
- Auth: Clerk with Google login.
- Auth implementation: `@clerk/nextjs`, `ClerkProvider`, and `src/proxy.ts` route protection.
- Database: Supabase Postgres with pgvector.
- Hosting: Vercel for app and lightweight APIs.
- Worker: GitHub Actions daily schedule plus manual dispatch.
- Embeddings: start with `BAAI/bge-small-en-v1.5`.
- Ranking: semantic relevance is more important than recency or citation count.
- Feed: full-screen mobile card deck.
- Swipe left: dismiss this paper.
- Swipe right: open paper detail and count as a light positive signal.
- Heart: favorite.
- Bookmark: save to default `Read later` playlist.
- Notes: post-MVP.

## Important Files

- `ROADMAP.md`: source of truth for product and architecture decisions.
- `README.md`: public-facing repository overview.
- `CHANGELOG.md`: short semver change history.
- `sessions/`: session records. Add a new `SESSIONN.md` file for major planning or implementation sessions.
- `logo/paperdeck-logo.svg`: repository logo.

## Working Rules

- Keep changes scoped and intentional.
- Update `ROADMAP.md` when product or architecture decisions change.
- Update `CHANGELOG.md` for notable repository changes.
- Add or update a session file when a session produces meaningful decisions or implementation work.
- Do not introduce paid services unless explicitly approved.
- Keep the architecture free-first.
- Do not put long-running ingestion, PDF parsing, or local embedding generation on Vercel Functions.
- Prefer official APIs and documented sources over scraping.
- Do not import or republish full text unless the license and source clearly allow it.
- Preserve LaTeX/math notation in abstracts and render it later with KaTeX or MathJax.

## Planned MVP Build Order

1. Scaffold Next.js with TypeScript.
2. Add mobile-first app shell.
3. Configure Clerk Google login. Done.
4. Configure Supabase and database schema.
5. Add interest onboarding.
6. Add paper card deck UI.
7. Add favorites and default `Read later` playlist.
8. Add ingestion worker for arXiv.
9. Add embeddings with `BAAI/bge-small-en-v1.5`.
10. Add initial ranking and recommendation feed.

## Validation Expectations

- Run relevant tests/checks before finalizing implementation work.
- If no tests exist yet, state that explicitly.
- Validate SVG/XML assets when edited.
- For frontend work, verify responsive mobile behavior before considering the task complete.
