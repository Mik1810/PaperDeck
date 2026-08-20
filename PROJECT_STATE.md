# PaperDeck Project State

Purpose: compact durable context for coding agents. Keep this file small.
For detailed/history-sensitive decisions, consult `ROADMAP.md` or the relevant document instead.

Last reviewed: 2026-08-20

Detailed current runtime architecture and shipped feature boundaries are
authoritative in `docs/architecture.md`. `ROADMAP.md` records durable decisions
and next steps; `sessions/` remains historical evidence.

## Product

- Mobile-first CS paper discovery and triage.
- Primary UX: one-paper-at-a-time deck/feed.
- Search is a local CS catalog search, not a general reference manager.
- Heart = Favorite.
- Swipe right = save to default `Read later`.
- Bookmark = private multi-playlist picker.
- Private research groups must remain isolated from personal ranking signals.

## Stack

- Next.js 16 / React 19 / TypeScript.
- Clerk with Google auth.
- Supabase Postgres + pgvector.
- Drizzle ORM.
- Vercel for the web app/lightweight APIs.
- GitHub Actions for scheduled/manual workers.
- Local/CI PostgreSQL runs in Docker.

## Data and security invariants

- User-owned rows identify the Clerk user with `owner_id text`.
- Privileged user operations are server-side and enforce resource ownership/auth.
- Never expose `.env.local`, service-role credentials, or private database URLs to browser code/logs.
- Production/Preview database access uses the Transaction pooler; maintenance/migrations use the appropriate Session connection.
- Local/CI schema parity is reconstructed from the initial baseline plus ordered Supabase migrations.
- Full text is linked rather than republished unless licensing explicitly permits import.

## Ranking and embeddings

- Primary ranking objective: semantic relevance to the user's interests.
- Current embedding model: `sentence-transformers/all-MiniLM-L6-v2`.
- Embeddings are generated outside Vercel.
- Supabase/pgvector stores paper/topic/profile vectors.
- Feed batches are persisted in `recommendations`; Postgres remains the caching layer for the MVP.
- Favorite and current private-playlist membership are current-state profile signals.
- Append-only collection events are analytics/history, not an extra duplicate profile weight.
- A stale profile embedding must not be used for semantic retrieval until its input generation catches up.
- Group activity must not feed personal ranking.

## Operational guardrails

- Free-first architecture; no paid dependency without explicit approval.
- Prefer official APIs/documented sources over scraping.
- Preserve LaTeX/math notation.
- Long-running ingestion, parsing, and local model inference do not belong in Vercel Functions.
- Make scoped changes and preserve unrelated dirty-worktree edits.

## Validation map

Start narrow; escalate only when needed.

- TypeScript: `npm run typecheck`
- Lint: `npm run lint`
- Unit: `npm run test:unit`
- Integration: `npm run test:integration`
- E2E: `npm run test:e2e`
- Full test: `npm test`
- Build: `npm run build`
- Test DB preparation: `npm run db:test:prepare`

Feature-specific scripts exist in `package.json`; inspect them before defaulting to a broad suite.

## Context policy

- One coherent issue/problem per Codex task/thread.
- Only one active PaperDeck coding session at a time.
- Use the main checkout with a dedicated issue branch; no separate worktree by default.
- Search before reading large files.
- Read only relevant sections of `ROADMAP.md`, `docs/`, and old session logs.
- Put durable knowledge here; implementation history belongs in `sessions/`.
- If a task pivots into materially different work, finish with a compact handoff and start a fresh task.
