# Session 23 — Zod validation layer + caching decision + UI polish

## Zod adoption (issue #65)

- Installed `zod` as direct dependency.
- Created 6 schema files under `src/lib/schemas/`:
  - `semantic-match.ts` — SemanticMatchRow for raw SQL results
  - `paper-access.ts` — PaperAccess enum + TriageSummary object
  - `arxiv-entry.ts` — arXiv XML feed, IngestionCursor, TopicRow, ID rows
  - `s2-paper.ts` — Semantic Scholar batch API, PaperRow, cursor
  - `oa-response.ts` — OpenAlex API, PaperRow, topic ID rows, cursor
  - `up-response.ts` — Unpaywall API, PaperRow, cursor
- Replaced all unsafe `as` casts with `.parse()` in 7 files:
  - `src/lib/repositories/semantic-retrieval.ts`
  - `src/lib/repositories/catalog.ts`
  - `scripts/ingest-arxiv.ts`
  - `scripts/enrich-semantic-scholar.ts`
  - `scripts/enrich-openalex.ts`
  - `scripts/enrich-unpaywall.ts`
- Removed duplicate local type declarations; now inferred from Zod.
- Build, typecheck, and 46/46 unit tests pass.

## Mobile card layout fixes

- Header z-index raised from `z-10` to `z-30` in `app-shell.tsx` to prevent card overlap.
- Title font: `text-2xl` → `text-xl sm:text-2xl` in `paper-card.tsx`.
- Abstract font: `text-[15px] leading-7` → `text-sm leading-relaxed`.
- Abstract: added `italic` class.
- Topic labels: `text-xs` → `text-[10px] sm:text-xs`.

## Login page logo fix

- Sign-in and sign-up pages: replaced "PD" placeholder with `Image` component loading `/icon.svg`.

## Caching layer decision (issue #66)

- Decided to **stay on Postgres-based caching** (table `recommendations`, 5-min TTL).
- No Redis/KV until thresholds: catalog >100k, GET /feed p95 >2s, sustained read QPS beyond free tier.
- Preferred post-threshold path: Next.js built-in cache first, then Vercel KV/Upstash if needed.
- Updated ROADMAP.md with the decision.

## Italian translations/summaries (issue #34)

- Closed as "not planned".
- Motivation: target user (CS researcher) reads English natively. LLM translation risks technical errors. Adds complexity with no real value. Already marked post-MVP/P3 in ROADMAP.

## Sci-Hub discussion (off-issue)

- Analyzed using Sci-Hub for paper ingestion/full-text.
- Decided against: legal risk, scraping fragility, no official API, violates project principles (free-first, prefer official sources).
- Current Unpaywall + OpenAlex OA approach is the right path.

## Full-text/RAG (issue #35)

- Closed as "not planned" for now.
- Motivation: no user demand, no concrete use case beyond existing abstract semantic retrieval.
- If revisited: only on clearly OA papers (arXiv + Unpaywall), using existing MiniLM pipeline + `paper_chunks` table.
