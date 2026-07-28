# Session 48

## Feed history consistency

- Investigated browser Back restoring an already-opened paper and the same deck sequence.
- Found that `Open` recorded `open_detail` server-side without advancing the client queue before navigation.
- Made opening a paper optimistically advance the local deck while retaining best-effort background interaction recording.
- Made current favorites and `Read later` items authoritative hidden feed state even when interaction history has been reset or pruned.
- Added unit coverage for collection-backed hidden state and a Playwright regression for `Open` followed by browser Back.
- Audited the real Development profile in read-only mode after the feedback reset: the regenerated live cache contains 17 recommendations, including 9 current Read later items and 2 favorites. No cache rows were deleted.

## Semantic candidate starvation

- Collected four no-write live recommendations and manual graded relevance
  labels: `1, 2, 0, 1`, yielding graded NDCG@4 `0.860`, mean grade `1.0/3`,
  and one strongly relevant result.
- Confirmed 1,332 MiniLM-embedded papers out of 2,184 catalog rows, while the
  100-request RPC returned only 28 candidates.
- Identified the root cause as the 100-list IVFFlat index running with the
  pgvector default of one probe.
- Verified in read-only trials that ten probes return 100 candidates, compared
  with 28 at one probe.
- Added and applied the Development migration that sets
  `ivfflat.probes = 10` on `match_papers_by_embedding`; it replaces only the
  function and modifies no data rows.
- Added catalog fill for semantic decks below 50 unseen candidates, a
  ten-visible-paper floor for cached batches, and per-paper `semantic` versus
  `catalog_fallback` provenance.
- Verified the updated Development RPC returns 100 loaded candidates and 75
  unseen ranked papers for the audited profile; the first 20 are semantic, so
  catalog fill remains inactive when unnecessary.

## Validation

- `npm run lint`
- `npm run typecheck`
- `npm run test:unit` — 82 passed
- `npm run evaluate:recommendations` — both suites passed with zero seen leakage
- `npm run evaluate:recommendations:latency` — passed; local reranker p95 remained below the informational 25 ms reference
- `npm run audit:service-role`
- Targeted Playwright regression for browser Back — Chromium desktop and mobile passed
- `npm run build`
- `git diff --check`
- Development RPC verification — 100 requested, 100 matched; function configured with `ivfflat.probes = 10`
