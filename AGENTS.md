# Agent Guide

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
- Database ownership: user-owned rows store Clerk user IDs in `owner_id text`.
- Database access MVP: user-specific queries should go through server-side code until Clerk JWT and Supabase RLS are configured end to end.
- Hosting: Vercel for app and lightweight APIs.
- Worker: GitHub Actions daily schedule plus manual dispatch.
- Embeddings: start with `BAAI/bge-small-en-v1.5`.
- Ranking: semantic relevance is more important than recency or citation count.
- Feed: full-screen mobile card deck.
- Heart: favorite.
- Bookmark: save to default `Read later` playlist.

## Important Files

- `ROADMAP.md`: source of truth for product and architecture decisions.
- `README.md`: public-facing repository overview.
- `CHANGELOG.md`: short semver change history.
- `sessions` folder: Here, in each new session of work, create the SESSIONi.md where i is the next session number.
- `docs` folder for specification.
- `supabase/schema.sql`: initial schema and policy draft.

## Working Rules

- Keep changes scoped and intentional.
- After each modification, save it on the SESSIONi.md file with a brief description of the change. 
- Before starting implementation work on a GitHub issue, briefly describe the issue being addressed, why it matters, and the intended attack plan.
- Update `ROADMAP.md` when product or architecture decisions change.
- Update `CHANGELOG.md` for notable repository changes.
- Add or update a session file when a session produces meaningful decisions or implementation work.
- Do not introduce paid services unless explicitly approved.
- Keep the architecture free-first.
- Do not expose any key in `.env.local` to browser code.
- Do not put long-running ingestion, PDF parsing, or local embedding generation on Vercel Functions.
- Prefer official APIs and documented sources over scraping.
- Do not import or republish full text unless the license and source clearly allow it.
- Preserve LaTeX/math notation in abstracts and render it later with KaTeX or MathJax.
- After working on a Github issue, update the issue with a summary of what was done and any next steps in correct markdown style. Eventually, close it when the work is complete.

## Validation Expectations

- Run relevant tests/checks before finalizing implementation work.
- After each modification, ask yourself if the change is complete, correct, and well-documented. Then, try to simplify the change and remove any unnecessary code or complexity, or useless dependencies.
- If no tests exist yet, state that explicitly.
- For frontend work, verify responsive mobile behavior before considering the task complete.
