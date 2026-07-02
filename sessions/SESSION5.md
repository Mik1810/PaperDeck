# Session 5

Date: 2026-07-02

Model: DeepSeek (deepseek-v4-pro) via opencode

## Goal

Complete the P1 pipeline: ingestion, enrichment, LLM summaries, embeddings, feed verification, Clerk JWT/RLS, and observability.

---

## Part 1 — Ingestion Pipeline (#10–#14)

### Starting Point
- arXiv ingestion verified only with `cs.CC` smoke slice.
- No historical backfill, no external enrichment.
- All enrichment tasks unchecked in TASKS.md.

### Issue #10 — Broadened arXiv ingestion beyond cs.CC
- Verified multi-category ingestion across 10 default CS categories.
- Dry-run: 18 fetched, 14 importable. Write: 21 imported, 27 fetched.
- 0 duplicate `arxiv_id` rows. Cursors for 9/10 categories.

### Issue #11 — Historical arXiv backfill mode
- Added `--backfill` flag and `--backfill-pages=N` to `scripts/ingest-arxiv.ts`.
- Paginates backwards using `start` offset, `getExistingArxivIds()` dedup.
- Separate backfill cursor (`arxiv_backfill:<category>`), incremental cursor untouched.
- Imported 418 papers across all categories. Final: 447 arXiv papers, 0 duplicates.

### Issue #12 — Semantic Scholar enrichment
- Created `scripts/enrich-semantic-scholar.ts` (`enrich:semantic-scholar`).
- S2 batch API lookup by arXiv ID (500 per batch).
- Enriched 277/447 papers: citation counts, S2 IDs, venue corrections, 32 DOIs.

### Issue #13 — OpenAlex enrichment
- Created `scripts/enrich-openalex.ts` (`enrich:openalex`).
- DOI-based lookup via OpenAlex filter API (`filter=doi:val1|val2|...`).
- Enriched 11 DOI-backed papers: OA IDs, venues, open access status, abstracts.
- Created 28 OpenAlex taxonomy topics linked via `paper_topics`.

### Issue #14 — Unpaywall open access links
- Created `scripts/enrich-unpaywall.ts` (`enrich:unpaywall`).
- One-by-one DOI lookup on Unpaywall API.
- 21 legal OA URLs stored in `paper_external_ids` (provider: `unpaywall_oa`).

---

## Part 2 — LLM Triage Summaries (#15–#16)

### Issue #15 — LLM triage summary on paper detail
- DB migration: `triage_summary` (JSONB), `triage_summary_model`, `triage_summary_generated_at` columns.
- Created `scripts/generate-summaries.ts` (`generate:summaries`).
- Jina AI Reader fetches full paper text from arXiv PDF → Nemotron (OpenRouter free) generates structured 4-field JSON summary.
- Paper detail page shows triage summary above abstract with `SummaryRow` component.
- `Paper` type + `catalog.ts` updated to read `triageSummary`.

### Issue #16 — Store summaries, don't generate live
- Summaries pre-computed by batch worker, stored in DB with model+timestamp metadata.
- App reads from `Paper.triageSummary` — zero LLM calls on page load.
- Graceful fallback: no summary → only abstract shown.

---

## Part 3 — LaTeX/Math Rendering (#17)

### Issue #17 — Preserve LaTeX readability
- Created `src/components/math-content.tsx` — MathJax 3 (tex-chtml) on-demand CDN load.
- Renders `$...$` and `$$...$$` delimiters in abstracts + triage summaries.
- Applied to paper detail page and feed card.

---

## Part 4 — Embeddings at Scale (#18–#19)

### Issue #18 — Topic embedding batches
- Ran `embed_topics.py` on all 64 taxonomy topics (BGE-small-en-v1.5).
- 60 new topic embeddings generated, 64 total in `topic_embeddings`.
- Applied missing `match_papers_by_embedding` RPC migration.

### Issue #19 — Paper embedding batches
- Ran `embed_papers.py` on all 447 arXiv papers (BGE-small-en-v1.5).
- 445 new paper embeddings, 449 total with embeddings.
- Verified: `match_papers_by_embedding` returns cosine similarity scores (1.000 self-match, 0.76–0.62 related).

---

## Part 5 — Feed + Semantic Retrieval (#20)

### Issue #20 — Verify feed with real user profile
- Wired `refreshUserProfileEmbedding()` into the flow at two points:
  - Onboarding: `saveOnboardingInterestsAction` builds profile after saving topics.
  - Feed: `getSemanticPaperCandidates` lazy-generates if missing (signature-based idempotency).
- Semantic pipeline now operational: topics → profile vector → pgvector cosine → ranking (120x weight).

---

## Part 6 — Clerk JWT + Supabase RLS (#23)

### Issue #23 — Clerk JWT for Supabase RLS
- Created `createClerkAuthenticatedClient()` in `src/lib/supabase/server.ts`.
- Uses `auth().getToken()` (default Clerk session token) + anon key (not service_role).
- No Clerk JWT template needed — default token already carries `sub`.
- RLS verified active: anon key returns 0 results (filtered), fake JWT gets 401.
- Added `verifyClerkRlsAction` smoke test, docs at `docs/clerk-supabase-rls.md`.

---

## Final State

### All P1 issues closed (this session):

| # | Area | Status |
|---|---|---|
| 10 | Multi-category ingestion | ✅ 447 papers |
| 11 | Historical backfill | ✅ `--backfill` mode |
| 12 | Semantic Scholar enrichment | ✅ 277 enriched |
| 13 | OpenAlex enrichment | ✅ 11 enriched, 28 topics |
| 14 | Unpaywall OA links | ✅ 21 URLs stored |
| 15 | LLM triage summary | ✅ Nemotron + Jina |
| 16 | Store summaries offline | ✅ JSONB in DB |
| 17 | LaTeX/math rendering | ✅ MathJax 3 |
| 18 | Topic embeddings | ✅ 64 vectors |
| 19 | Paper embeddings | ✅ 449 vectors |
| 20 | Feed semantic verification | ✅ Profile wired |
| 23 | Clerk JWT + RLS | ✅ Configured |

### New npm scripts:
```
ingest:arxiv       — arXiv ingestion + backfill
enrich:semantic-scholar  — S2 metadata enrichment
enrich:openalex          — OpenAlex enrichment
enrich:unpaywall         — Unpaywall OA lookup
generate:summaries       — LLM triage summaries
```

### New files created:
```
scripts/enrich-semantic-scholar.ts
scripts/enrich-openalex.ts
scripts/enrich-unpaywall.ts
scripts/generate-summaries.ts
src/components/math-content.tsx
docs/clerk-supabase-rls.md
sessions/SESSION5.md
supabase/migrations/20260702111811_add_triage_summary_columns.sql
```

### Database state:
```
papers (source=arxiv):     447
papers with S2 ID:         277
papers with OA ID:         11
papers with embeddings:    449 (447 arXiv + 2 seed)
topic_embeddings:          64
taxonomy_topics:           64
unpaywall_oa external IDs: 24
triage summaries:          6
```

### Remaining P1:
```
#21 — Observability for semantic retrieval decisions
#22 — Offline benchmark plan
#24 — Audit service-role usage
#25 — Secret rotation checklist
#8 — Update ROADMAP.md status (partially done)
#9 — Normalize SESSION2.md
```

---

## Part 7 — Paper Detail UI Refinements

### Changes requested
- Summary moved **below** abstract (not above)
- Card widened to `max-w-4xl` (full-page with classic padding)
- Abstract font: `text-sm italic text-slate-600` (smaller, italic)
- Summary prompt improved: ~100 words per field, no abstract paraphrasing

### Implementation
- `src/app/papers/[paperId]/page.tsx`: reordered sections, widened card, italic abstract
- `scripts/generate-summaries.ts`: prompt rewritten for specificity, `max_tokens` increased to 1600

---

## Part 8 — LLM Provider Saga

### Model timeline

| Order | Provider | Model | Why tried | Why abandoned |
|---|---|---|---|---|
| 1 | OpenRouter | `nousresearch/deephermes-3-llama-3-8b:free` | Scelto dall'utente, free su OpenRouter | Non disponibile sulla free tier |
| 2 | OpenRouter | `google/gemma-4-31b-it:free` | Buon bilanciamento velocità/qualità, 262K ctx | 429 rate-limited |
| 3 | OpenRouter | `nvidia/nemotron-3-nano-30b-a3b:free` | 256K ctx, costantemente disponibile | Funzionava ma output JSON rotto (reasoning text contaminava il content). Poi 429 globale |
| 4 | OpenRouter | Vari (`meta-llama/llama-3.3-70b`, `qwen/qwen3-coder`, `nousresearch/hermes-3-405b`) | Provati come alternative | Tutti 429 o 503 — free tier OpenRouter satura |
| 5 | OpenRouter | `nvidia/nemotron-nano-9b-v2:free` | Non-reasoning, output pulito | Content null, reasoning-only. 429 globale |
| 6 | OpenRouter | `openai/gpt-oss-20b:free` | OpenAI-compatibile | Content null, reasoning-only. 429 globale |
| 7 | Groq | `llama-3.1-8b-instant` | Free tier più generoso, OpenAI-compatibile, 128K ctx | 413 Payload Too Large (chunk > limite Groq free). Poi 429 rate-limiting anche con retry e delay 15-30s |
| 8 | Google Gemini | `gemini-2.0-flash` (OpenAI endpoint) | 1M ctx, nessun chunking, 15 RPM free | Limit: 0 sul free tier (richiede piano a pagamento) |
| 9 | Google Gemini | `gemini-1.5-flash`, `gemini-1.5-pro`, `gemma-3-27b-it` (OpenAI endpoint) | Modelli free classici | 404 — non disponibili su questa API key |
| 10 | Google Gemini | `gemini-2.0-flash-lite` (OpenAI endpoint) | Versione light, dovrebbe essere free | Limit: 0 — stesso problema del flash normale |
| 11 | Google Gemini | **`gemini-flash-latest` (API nativa)** | Disponibile, risponde 200, 1M ctx, `responseMimeType: application/json` per JSON garantito | ✅ Corrente. 503 intermittenti (picchi di domanda Google) ma retry a 5 tentativi mitiga |

### Perché siamo passati all'API nativa Gemini

L'endpoint OpenAI-compatibile di Gemini (`generativelanguage.googleapis.com/v1beta/openai/chat/completions`) ha problemi:
- Modelli free tier non disponibili (404 o limit: 0)
- Instabile (503 frequenti)
- `response_format: json_object` non sempre rispettato

L'API nativa (`generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`) invece:
- `responseMimeType: "application/json"` garantisce JSON pulito
- `system_instruction` separato dal contenuto utente
- API key nel URL (più semplice, nessun header Authorization)
- Disponibilità migliore dei modelli free

### Problema corrente

Gemini `gemini-flash-latest` restituisce 503 intermittenti ("model experiencing high demand"). Il retry a 5 tentativi con backoff 15-30-45-60-75s mitiga ma non risolve completamente. Raccomandato: `limit: 2-3`, `batch_size: 1`.

---

## Part 9 — Summary Pipeline Architecture

### Flow
```
GitHub Actions workflow (manual or cron daily)
  → Jina AI Reader fetches PDF text from arxiv.org/pdf/{id}
  → cleanText() strips garbled LaTeX/Unicode artifacts
  → chunkText() splits at 500K chars (Gemini has 1M context, so rarely chunks)
  → callGemini() sends to native Gemini API with system_instruction + responseMimeType
  → JSON.parse() validates 4-field summary
  → upsertPaper() stores triage_summary JSONB + model + timestamp in papers table
  → updateCursor() tracks progress in ingestion_cursors
```

### Paper detail page flow
```
Server component fetches paper via catalog.ts (paperSelect includes triage_summary)
  → If triageSummary exists: renders 4-section summary below abstract
  → If missing: only abstract shown (no loading, no LLM call on page load)
  → MathJax 3 renders LaTeX in both abstract and summary
```

---

## Part 10 — Commit History (abbreviated)

```
eea8569 feat: complete P1 pipeline — ingestion, enrichment, summaries, embeddings, RLS
1858e4c feat: add GitHub Actions workflow for summary generation
0e5c593 fix: add triage_summary to paperSelect query
296c143 fix: improve paper detail layout and summary prompt
567b5eb fix: increase max_tokens to 1200
42411ac feat: 100-word summaries, no abstract repetition
1d4b294 fix: add retry logic for 429 rate limits
98fd8ca fix: increase workflow delay to 30s
094c170 fix: reduce chunk size to 15K for Groq
61b475f fix: handle monolithic text from Jina when chunking
e74336e fix: use first 15K chars only
96725a8 fix: restore full-text chunking with 3s delay
40ac743 fix: increase workflow timeout to 60min
f4decdc fix: clean Jina PDF artifacts, improve prompt resilience
8b9e072 feat: switch to Gemini 2.0 Flash
d6db34b fix: add 5s delay between papers within batch
f2ac8b7 feat: use native Gemini API (gemini-flash-latest)
9964264 fix: retry on 503 as well as 429
5ff4dc6 fix: 5 retries, raw JSON parse
```

---

## Current State (end of session)

### Database
```
papers (source=arxiv):     447
papers with S2 ID:         277
papers with OA ID:         11
papers with embeddings:    449
topic_embeddings:          64
triage summaries:          0 (cleared for regeneration with new prompt)
```

### Issues closed this session
```
#10, #11, #12, #13, #14, #15, #16, #17, #18, #19, #20, #23
```

### Issues in progress
```
#15 — Summary generation pipeline working, but Gemini 503 intermittent
#38 — Created for summary storage review (future scaling concern)
```

### Next steps
1. Stabilize summary generation (reduce batch size, wait for Gemini to cool down)
2. #21 — Semantic retrieval observability
3. #22 — Embedding benchmark plan
4. #24/#25 — Security audit and rotation checklist

