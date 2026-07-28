import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateRecommendationStability,
  recommendationStabilityFailures,
  RECOMMENDATION_SANITY_FIXTURE_VERSION,
  RECOMMENDATION_SANITY_THRESHOLDS,
  RECOMMENDATION_STABILITY_FIXTURE_VERSION,
  RECOMMENDATION_STABILITY_THRESHOLDS,
} from "../../src/lib/ranking/stability-evaluation";
import { FEED_RANKER_VERSION } from "../../src/lib/ranking/feed-ranking";
import { recommendationStabilityV2 } from "../fixtures/recommendation-stability-v2";
import type { Paper } from "../../src/types/paper";

function paper(id: string, topicId: string): Paper {
  return {
    id,
    title: id,
    authors: ["Fixture"],
    year: 2024,
    source: "arXiv",
    abstract: "Fixture",
    topics: [{ id: topicId, label: topicId }],
    recommendationReason: "",
    url: `https://example.invalid/${id}`,
    access: "open",
  };
}

test("recommendation stability fixture pins ranker and produces repeatable metrics", () => {
  const papers = [paper("a-1", "a"), paper("a-2", "a"), paper("b-1", "b"), paper("b-2", "b")];
  const metrics = evaluateRecommendationStability(
    [
      {
        id: "a",
        papers,
        topics: [{ id: "a", parentId: null }, { id: "b", parentId: null }],
        selectedTopicIds: ["a"],
        semanticScores: { "a-1": 0.9, "a-2": 0.8, "b-1": 0.1, "b-2": 0.1 },
        relevanceGrades: { "a-1": 1, "a-2": 1 },
      },
      {
        id: "b",
        papers,
        topics: [{ id: "a", parentId: null }, { id: "b", parentId: null }],
        selectedTopicIds: ["b"],
        semanticScores: { "a-1": 0.1, "a-2": 0.1, "b-1": 0.9, "b-2": 0.8 },
        relevanceGrades: { "b-1": 1, "b-2": 1 },
      },
    ],
    {
      topK: 2,
      latencyIterations: 1,
      fixtureVersion: RECOMMENDATION_SANITY_FIXTURE_VERSION,
    },
  );

  assert.equal(metrics.rankerVersion, FEED_RANKER_VERSION);
  assert.equal(metrics.fixtureVersion, RECOMMENDATION_SANITY_FIXTURE_VERSION);
  assert.equal(metrics.meanNdcgAtK, 1);
  assert.equal(metrics.minNdcgAtK, 1);
  assert.equal(metrics.meanRecallAtK, 1);
  assert.equal(metrics.minRecallAtK, 1);
  assert.equal(metrics.catalogExposureCoverageAtK, 1);
  assert.equal(metrics.meanPairwiseOverlapAtK, 0);
  assert.equal(metrics.seenLeakageCount, 0);
  assert.equal(typeof metrics.p95RerankLatencyMs, "number");
  assert.deepEqual(
    recommendationStabilityFailures(metrics, RECOMMENDATION_SANITY_THRESHOLDS),
    [],
  );
});

test("challenging fixture produces a non-perfect approved baseline", () => {
  const metrics = evaluateRecommendationStability(recommendationStabilityV2, {
    topK: 5,
    fixtureVersion: RECOMMENDATION_STABILITY_FIXTURE_VERSION,
  });

  assert.ok(metrics.meanNdcgAtK > 0.92 && metrics.meanNdcgAtK < 0.94);
  assert.ok(metrics.minNdcgAtK > 0.85 && metrics.minNdcgAtK < 0.86);
  assert.ok(metrics.meanRecallAtK > 0.9 && metrics.meanRecallAtK < 0.92);
  assert.equal(metrics.minRecallAtK, 0.8);
  assert.ok(
    metrics.catalogExposureCoverageAtK > 0.66 &&
      metrics.catalogExposureCoverageAtK < 0.67,
  );
  assert.ok(
    metrics.meanPairwiseOverlapAtK > 0.19 &&
      metrics.meanPairwiseOverlapAtK < 0.21,
  );
  assert.equal(metrics.seenLeakageCount, 0);
  assert.deepEqual(
    recommendationStabilityFailures(
      metrics,
      RECOMMENDATION_STABILITY_THRESHOLDS,
    ),
    [],
  );
});

test("recommendation stability gate reports failed thresholds", () => {
  const failures = recommendationStabilityFailures({
    rankerVersion: FEED_RANKER_VERSION,
    fixtureVersion: RECOMMENDATION_STABILITY_FIXTURE_VERSION,
    topK: 4,
    scenarioCount: 1,
    meanNdcgAtK: 0,
    minNdcgAtK: 0,
    meanRecallAtK: 0,
    minRecallAtK: 0,
    catalogExposureCoverageAtK: 0,
    meanPairwiseOverlapAtK: 1,
    seenLeakageCount: 1,
    scenarios: [
      {
        scenarioId: "failed",
        ndcgAtK: 0,
        recallAtK: 0,
        seenLeakageCount: 1,
      },
    ],
    p95RerankLatencyMs: null,
  }, RECOMMENDATION_STABILITY_THRESHOLDS);
  assert.deepEqual(failures, [
    "meanNdcgAtK",
    "minNdcgAtK",
    "meanRecallAtK",
    "minRecallAtK",
    "catalogExposureCoverageAtK",
    "meanPairwiseOverlapAtK",
    "seenLeakageCount",
  ]);
});
