# Session 47

## Discriminating recommendation-stability baseline

- Revisited issue #91 after the user observed that the original NDCG, recall, coverage, and overlap baseline was perfect by construction.
- Preserved the original three-profile fixture as `paperdeck-recommendation-sanity-v1`, an explicitly synthetic mechanical check rather than evidence of product quality.
- Added `paperdeck-recommendation-stability-v2` with four overlapping profiles, 21 multi-topic papers, graded relevance, noisy semantic scores, positive and negative feedback, seen papers, and conflicts among semantic, topic, citation, recency, and classic signals.
- Added worst-profile NDCG and recall floors so averages cannot hide one poorly served profile.
- Renamed catalog coverage to catalog exposure coverage and added a hard zero seen-paper leakage invariant.
- Calibrated and documented the user-approved challenging thresholds and non-perfect baseline.
- Kept reranker p95 informational and separate from the deterministic CI gate.

## Validation

- `npm run lint`
- `npm run typecheck`
- `npm run test:unit` — 78 passed
- `npm run evaluate:recommendations`
- `npm run evaluate:recommendations:latency`
- `npm run build`
- `npm run audit:service-role`
