# Session 37

## Recommendation-core stability gate

- Started GitHub issue #91 to make ranking stability measurable before expanding persistent social features.
- Pinned the hybrid ranker as `paperdeck-hybrid-ranker-v1` and the offline fixture as `paperdeck-recommendation-stability-v1`.
- Added `npm run evaluate:recommendations`, with explicit blocking thresholds for NDCG@4, Recall@4, catalog coverage, and cross-profile overlap.
- Moved the versioned fixture into a dedicated test fixture file instead of embedding it in the runner.
- Added the deterministic gate to App CI; reranker p95 is an informational `25 ms` reference in a separate manual/weekly workflow to avoid noisy-runner failures.
- Documented gate scope, thresholds, live observability, limitations, and future user-judgement follow-up.
- Extended friendship isolation coverage to prove social mutations do not write recommendation impressions, interactions, cached recommendations, or user profile embeddings.
- Initial offline gate passed with NDCG, recall, and coverage at `1` and overlap at `0`; the measured reranker p95 remained below the informational `25 ms` reference.

## Validation

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit` — 60 passed
- `npm run evaluate:recommendations`
- `npm run evaluate:recommendations:latency`
- `node --import tsx --test tests/integration/friendships-rls.test.ts` — 8 passed
- `npm run build`
