# Recommendation Stability Gate

PaperDeck pins the current hybrid reranker as `paperdeck-hybrid-ranker-v1` and
checks it with two deterministic offline suites before social features can
advance. Run both suites with:

```bash
npm run evaluate:recommendations
```

The command is offline, deterministic, performs no database writes, and exits
non-zero when either suite fails. App CI runs it on every pull request and push
to `main`.

## Evaluation tiers

`paperdeck-recommendation-sanity-v1` is a deliberately simple mechanical check:
three disjoint profiles, twelve papers, binary relevance, and clean semantic
scores at `K = 4`. Its perfect result is expected by construction. It detects
gross ranking, coverage, or personalization breakage but is not a product-quality
baseline.

`paperdeck-recommendation-stability-v2` is the blocking challenging baseline. It
uses four overlapping profiles and 21 multi-topic papers at `K = 5`, with
graded relevance, noisy semantic scores, positive and negative feedback, seen
papers, and conflicts between semantic relevance, topic affinity, citations,
recency, and classic status.

## Challenging-baseline thresholds

| Metric | Acceptance threshold | Purpose |
| --- | ---: | --- |
| Mean graded NDCG@5 | `>= 0.88` | Highly relevant papers stay near the top across profiles. |
| Worst-profile graded NDCG@5 | `>= 0.75` | A good average cannot hide one badly ordered profile. |
| Mean Recall@5 | `>= 0.80` | Profiles retrieve most labelled-relevant candidates. |
| Worst-profile Recall@5 | `>= 0.65` | No profile silently loses most of its relevant set. |
| Catalog exposure coverage@5 | `>= 0.55` | Recommendations do not collapse onto a small shared subset. |
| Mean pairwise overlap@5 | `<= 0.35` | Overlap is allowed for multi-topic papers without homogenizing decks. |
| Seen-paper leakage | `= 0` | Papers marked as seen never return in the evaluated top five. |

The approved v2 baseline is intentionally non-perfect:

- mean graded NDCG@5: `0.929`;
- worst-profile graded NDCG@5: `0.851`;
- mean Recall@5: `0.908`;
- worst-profile Recall@5: `0.800`;
- catalog exposure coverage@5: `0.667`;
- mean pairwise overlap@5: `0.200`;
- seen-paper leakage: `0`.

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

These thresholds protect the current implementation from deterministic
regressions under a more adversarial synthetic workload. They are still not
evidence of production recommendation quality. User-judgement metrics remain
the product gate once enough attributed impressions exist.

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
