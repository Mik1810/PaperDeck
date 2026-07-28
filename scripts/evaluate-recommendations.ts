import { appendFileSync } from "node:fs";
import {
  evaluateRecommendationStability,
  recommendationStabilityFailures,
  RECOMMENDATION_RERANK_LATENCY_REFERENCE_MS,
  RECOMMENDATION_SANITY_FIXTURE_VERSION,
  RECOMMENDATION_SANITY_THRESHOLDS,
  RECOMMENDATION_STABILITY_FIXTURE_VERSION,
  RECOMMENDATION_STABILITY_THRESHOLDS,
} from "../src/lib/ranking/stability-evaluation";
import { recommendationStabilityV1 } from "../tests/fixtures/recommendation-stability-v1";
import { recommendationStabilityV2 } from "../tests/fixtures/recommendation-stability-v2";

const measureLatency = process.argv.includes("--measure-latency");
const suites = [
  {
    id: "synthetic-sanity",
    metrics: evaluateRecommendationStability(recommendationStabilityV1, {
      topK: 4,
      fixtureVersion: RECOMMENDATION_SANITY_FIXTURE_VERSION,
    }),
    thresholds: RECOMMENDATION_SANITY_THRESHOLDS,
  },
  {
    id: "challenging-regression",
    metrics: evaluateRecommendationStability(recommendationStabilityV2, {
      topK: 5,
      latencyIterations: measureLatency ? 100 : 0,
      fixtureVersion: RECOMMENDATION_STABILITY_FIXTURE_VERSION,
    }),
    thresholds: RECOMMENDATION_STABILITY_THRESHOLDS,
  },
].map((suite) => ({
  ...suite,
  failures: recommendationStabilityFailures(suite.metrics, suite.thresholds),
}));
const failures = suites.flatMap((suite) =>
  suite.failures.map((failure) => `${suite.id}:${failure}`),
);
const challengingMetrics = suites[1].metrics;
const latencyWithinReference =
  challengingMetrics.p95RerankLatencyMs === null ||
  challengingMetrics.p95RerankLatencyMs <=
    RECOMMENDATION_RERANK_LATENCY_REFERENCE_MS;
const result = {
  passed: failures.length === 0,
  suites,
  latencyReferenceMs: RECOMMENDATION_RERANK_LATENCY_REFERENCE_MS,
  latencyWithinReference,
  failures,
};

console.log(JSON.stringify(result, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  const latencyDisplay =
    challengingMetrics.p95RerankLatencyMs === null
      ? "not measured"
      : `${challengingMetrics.p95RerankLatencyMs.toFixed(3)} ms`;
  const summaryLines = suites.flatMap((suite) => [
    `### ${suite.id}`,
    "",
    `- Gate: ${suite.failures.length ? "failed" : "passed"}`,
    `- Ranker: \`${suite.metrics.rankerVersion}\``,
    `- Fixture: \`${suite.metrics.fixtureVersion}\``,
    `- Mean NDCG@${suite.metrics.topK}: ${suite.metrics.meanNdcgAtK.toFixed(3)}`,
    `- Worst-profile NDCG@${suite.metrics.topK}: ${suite.metrics.minNdcgAtK.toFixed(3)}`,
    `- Mean Recall@${suite.metrics.topK}: ${suite.metrics.meanRecallAtK.toFixed(3)}`,
    `- Worst-profile Recall@${suite.metrics.topK}: ${suite.metrics.minRecallAtK.toFixed(3)}`,
    `- Catalog exposure coverage@${suite.metrics.topK}: ${suite.metrics.catalogExposureCoverageAtK.toFixed(3)}`,
    `- Pairwise overlap@${suite.metrics.topK}: ${suite.metrics.meanPairwiseOverlapAtK.toFixed(3)}`,
    `- Seen-paper leakage: ${suite.metrics.seenLeakageCount}`,
    "",
  ]);
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "## Recommendation stability",
      "",
      `- Deterministic gate: ${failures.length ? "failed" : "passed"}`,
      "",
      ...summaryLines,
      `- Challenging-fixture reranker p95: ${latencyDisplay} (informational reference ${RECOMMENDATION_RERANK_LATENCY_REFERENCE_MS} ms)`,
      "",
    ].join("\n"),
  );
}

if (failures.length) process.exitCode = 1;
