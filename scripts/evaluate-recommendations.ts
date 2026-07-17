import { appendFileSync } from "node:fs";
import {
  evaluateRecommendationStability,
  recommendationStabilityFailures,
  RECOMMENDATION_RERANK_LATENCY_REFERENCE_MS,
  RECOMMENDATION_STABILITY_THRESHOLDS,
} from "../src/lib/ranking/stability-evaluation";
import { recommendationStabilityV1 } from "../tests/fixtures/recommendation-stability-v1";

const measureLatency = process.argv.includes("--measure-latency");
const metrics = evaluateRecommendationStability(recommendationStabilityV1, {
  latencyIterations: measureLatency ? 100 : 0,
});
const failures = recommendationStabilityFailures(metrics);
const latencyWithinReference =
  metrics.p95RerankLatencyMs === null ||
  metrics.p95RerankLatencyMs <= RECOMMENDATION_RERANK_LATENCY_REFERENCE_MS;
const result = {
  passed: failures.length === 0,
  metrics,
  thresholds: RECOMMENDATION_STABILITY_THRESHOLDS,
  latencyReferenceMs: RECOMMENDATION_RERANK_LATENCY_REFERENCE_MS,
  latencyWithinReference,
  failures,
};

console.log(JSON.stringify(result, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "## Recommendation stability",
      "",
      `- Deterministic gate: ${failures.length ? "failed" : "passed"}`,
      `- Ranker: \`${metrics.rankerVersion}\``,
      `- Fixture: \`${metrics.fixtureVersion}\``,
      `- NDCG@${metrics.topK}: ${metrics.meanNdcgAtK.toFixed(3)}`,
      `- Recall@${metrics.topK}: ${metrics.meanRecallAtK.toFixed(3)}`,
      `- Catalog coverage@${metrics.topK}: ${metrics.catalogCoverageAtK.toFixed(3)}`,
      `- Pairwise overlap@${metrics.topK}: ${metrics.meanPairwiseOverlapAtK.toFixed(3)}`,
      `- Reranker p95: ${metrics.p95RerankLatencyMs?.toFixed(3) ?? "not measured"} ms (informational reference ${RECOMMENDATION_RERANK_LATENCY_REFERENCE_MS} ms)`,
      "",
    ].join("\n"),
  );
}

if (failures.length) process.exitCode = 1;
