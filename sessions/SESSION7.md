# Session 7

Date: 2026-07-02

Model: DeepSeek (deepseek-v4-pro) via opencode

## Goal

Close remaining P1 documentation issues (#8, #9) and plan next work.

---

## Issue #8 — Update ROADMAP.md implementation status

Updated `ROADMAP.md` "Stato implementazione" to reflect all work completed through SESSION6:

- Embedding batch completi (64 topic + 449 paper) — non piu "primo smoke batch"
- LLM triage summaries with GitHub Models provider
- Clerk JWT + Supabase RLS configurato e verificato
- MathJax 3 per rendering LaTeX
- Audit service-role + checklist rotazione secret
- Playwright smoke tests
- Osservabilita semantic retrieval con `feed_timing` esteso
- Aggiunta sezione "Prossimi passi" con benchmark embeddings, review summary storage, feature P2

---

## Issue #9 — Normalize SESSION2.md

Riorganizzato il finale di SESSION2.md:

- **Open Questions**: 8 domande aperte numerate in modo chiaro
- **Next Steps**: 10 passi ordinati per priorita, dal piu immediato (GitHub secrets) al piu avanzato (benchmark)
- **Stato finale**: riassunto della sessione con conteggi e stato RLS
- Rimosso testo duplicato italiano/inglese
- Rimossa nota di incoerenza docs (non piu rilevante — ROADMAP ora allineato)

---

## Issues closed

```
#8  — Update ROADMAP.md implementation status
#9  — Normalize the end of sessions/SESSION2.md
```

## Remaining P1

```
#22 — Execute offline benchmark plan (embeddings)
#38 — Review triage summary storage strategy
```

## Next candidate

#22 — eseguire il piano di benchmark offline in `docs/embeddings.md`:
confrontare BGE-small, E5-small-v2 e MiniLM per Recall@20, NDCG@20, MRR@10, latenza, storage.

---

## Issue #22 — Embedding Benchmark

Created `scripts/benchmark_embeddings.py` — fully offline, no DB writes, all vectors in NumPy arrays in RAM.

### Methodology
- 3 models compared: `BAAI/bge-small-en-v1.5`, `intfloat/e5-small-v2`, `sentence-transformers/all-MiniLM-L6-v2`
- Data: 64 topics (31 with arxiv_category), 447 arXiv papers
- Proxy metric: Rec@20 = fraction of top-20 cosine-similar papers that share the same arXiv category
- Category overlap used as relevance proxy (no manual labeling needed)

### Results
| Model | Rec@20 | Med@20 | Paper Encode | Delta vs BGE |
|---|---|---|---|---|
| **all-MiniLM-L6-v2** | **0.206** | 0.000 | **0.9s** | **+17.4%** |
| BGE-small-v1.5 | 0.176 | 0.050 | 3.1s | baseline |
| E5-small-v2 | 0.165 | 0.050 | 2.9s | -6.4% |

### Decision
Switch default from BGE-small to **all-MiniLM-L6-v2**:
- Exceeds 10% improvement threshold (+17.4%)
- 3x faster paper encoding (0.9s vs 3.1s for 447 papers)
- Same 384-dim output, no schema changes needed

Updated `docs/embeddings.md` with benchmark table.

### Model switch implementation
Replaced BGE-small with MiniLM everywhere:
- `scripts/embedding_common.py`: DEFAULT_MODEL
- `src/lib/repositories/user-profile-embeddings.ts`: EMBEDDING_MODEL constant
- `.env.example`, `.github/workflows/embed-papers.yml`
- `supabase/schema.sql`, migration: match_papers_by_embedding RPC default
- Regenerated 64 topic + 449 paper embeddings with MiniLM

### Issues closed
```
#8, #9, #22
```

## Remaining P1
```
#38 — Review triage summary storage strategy (post-MVP)
```

All P0-P1 issues are now CLOSED. Only #38 (post-MVP/scaling) remains open.
