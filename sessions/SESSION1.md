# Session 1

Date: 2026-07-01

## Goal

Define the initial product direction for PaperDeck and prepare the repository with planning, branding, and process documentation.

## Summary

This session established PaperDeck as a mobile-first academic paper discovery app for computer science. The core experience is a social-style full-screen paper deck where users choose academic interests, browse recommended paper cards, open detail views, dismiss irrelevant papers, and save papers to favorites or private playlists.

## Product Decisions

- Product name: `PaperDeck`.
- Repository name: `paperdeck`.
- Repository visibility: public.
- Domain: computer science only for the MVP.
- Authentication: Clerk with Google login.
- UI direction: social-like mobile-first deck.
- Feed layout: one full-screen card at a time.
- Swipe left: dismiss this paper.
- Swipe right: open paper detail and count as a light positive ranking signal.
- Heart: save to favorites.
- Bookmark: save to default `Read later` playlist.
- Abstract: show around 10 lines on mobile, expandable and scrollable.
- Paper classics: allowed, capped around 10-15% of the feed.
- Digest: in-app only for MVP.
- Personal notes: post-MVP.

## Technical Decisions

- App framework: Next.js with TypeScript.
- Hosting: Vercel for frontend and lightweight API routes.
- Database: Supabase Postgres.
- Vector search: pgvector.
- Supabase region preference: `eu-central-2` Zurich if available, fallback `eu-central-1` Frankfurt, then `eu-west-3` Paris.
- Batch worker: GitHub Actions, scheduled daily and runnable manually.
- Embedding model for MVP: `BAAI/bge-small-en-v1.5`.
- Later embedding comparison: `intfloat/e5-small-v2` and `sentence-transformers/all-MiniLM-L6-v2`.
- Data sources: start with arXiv, then enrich with Semantic Scholar, OpenAlex, Unpaywall, DBLP, and Crossref.
- Full text: link externally in MVP; internal RAG/full-text processing only for legally available open access content later.

## Files Created

- `ROADMAP.md`: product and technical roadmap.
- `README.md`: public repository overview.
- `logo/paperdeck-logo.svg`: repository logo.

## Files Added In This Follow-Up

- `sessions/SESSION1.md`: this session record.
- `CHANGELOG.md`: semver changelog starting at `0.0.0`.
- `AGENT.md`: operating guide for future agent work.

## Open Questions

- Exact Supabase RLS policies for profiles, favorites, playlists, and interactions.
- Post-feed benchmark for BGE-small vs E5-small-v2 vs MiniLM.

## Next Suggested Step

Scaffold the application with Next.js, TypeScript, Clerk, Supabase, pgvector-ready schema planning, and the first mobile-first UI shell.
