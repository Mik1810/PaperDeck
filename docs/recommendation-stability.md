# Recommendation Stability Gate

PaperDeck pins the current hybrid reranker as `paperdeck-hybrid-ranker-v1` and
checks it against fixture `paperdeck-recommendation-stability-v1` before social
features can advance. Run the gate with:

```bash
npm run evaluate:recommendations
```

The command is offline, deterministic, performs no database writes, and exits
non-zero when a quality threshold fails. App CI runs it on every pull request
and push to `main`.

## Metrics and thresholds

The fixture contains three distinct CS-interest profiles and twelve papers. Each
profile has four explicit relevance labels. The first gate uses `K = 4`.

| Metric | Acceptance threshold | Purpose |
| --- | ---: | --- |
| Mean NDCG@4 | `>= 0.90` | Relevant papers stay near the top. |
| Mean Recall@4 | `>= 0.75` | Each profile retrieves most labelled-relevant papers. |
| Catalog coverage@4 | `>= 0.80` | Recommendations do not collapse onto a small shared subset. |
| Mean pairwise overlap@4 | `<= 0.25` | Distinct profiles do not receive substantially identical decks. |

Reranker p95 has an initial `25 ms` informational reference, not a blocking CI
threshold. Shared GitHub runners are noisy enough that latency should not reject
an otherwise correct change.

## Latency workflow

Run the complete evaluation locally with:

```bash
npm run evaluate:recommendations:latency
```

`.github/workflows/recommendation-stability.yml` runs the same command manually
or every Monday. It reports p95 against the reference ceiling in its job summary
without making latency a merge gate. Persistent regressions should first be
confirmed locally and against production `feed_timing` before changing code or
promoting latency to a blocking threshold.

These thresholds protect the current implementation from mechanical regressions;
they are not evidence of production recommendation quality. User-judgement
metrics remain the product gate once enough attributed impressions exist.

## Live observability

Production feed reads emit `feed_timing` with total and phase timings, source,
ranked count, semantic retrieval diagnostics, and impression-batch duration.
Recommendation impressions retain the model version used for the shown deck.
The operational follow-up is to monitor feed p95, fallback rate, attributed
positive/negative actions, and repeated-paper rate by model version.

## Social isolation

Friend requests, friendships, and blocks must not write recommendation
impressions, `user_paper_interactions`, cached `recommendations`, or
`user_profile_embeddings`. The friendship integration suite snapshots all four
stores around a social mutation. Future group, notification, shared-paper, or
chat features must extend the same invariant before their issue can close.

No social activity may influence ranking without a separate documented,
opt-in experiment with its own model version and rollback path.
