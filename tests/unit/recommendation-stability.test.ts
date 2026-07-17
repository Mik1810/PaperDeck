import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateRecommendationStability,
  recommendationStabilityFailures,
  RECOMMENDATION_STABILITY_FIXTURE_VERSION,
} from "../../src/lib/ranking/stability-evaluation";
import { FEED_RANKER_VERSION } from "../../src/lib/ranking/feed-ranking";
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
        relevantPaperIds: ["a-1", "a-2"],
      },
      {
        id: "b",
        papers,
        topics: [{ id: "a", parentId: null }, { id: "b", parentId: null }],
        selectedTopicIds: ["b"],
        semanticScores: { "a-1": 0.1, "a-2": 0.1, "b-1": 0.9, "b-2": 0.8 },
        relevantPaperIds: ["b-1", "b-2"],
      },
    ],
    { topK: 2, latencyIterations: 1 },
  );

  assert.equal(metrics.rankerVersion, FEED_RANKER_VERSION);
  assert.equal(metrics.fixtureVersion, RECOMMENDATION_STABILITY_FIXTURE_VERSION);
  assert.equal(metrics.meanNdcgAtK, 1);
  assert.equal(metrics.meanRecallAtK, 1);
  assert.equal(metrics.catalogCoverageAtK, 1);
  assert.equal(metrics.meanPairwiseOverlapAtK, 0);
  assert.equal(typeof metrics.p95RerankLatencyMs, "number");
  assert.deepEqual(recommendationStabilityFailures(metrics), []);
});

test("recommendation stability gate reports failed thresholds", () => {
  const failures = recommendationStabilityFailures({
    rankerVersion: FEED_RANKER_VERSION,
    fixtureVersion: RECOMMENDATION_STABILITY_FIXTURE_VERSION,
    topK: 4,
    scenarioCount: 1,
    meanNdcgAtK: 0,
    meanRecallAtK: 0,
    catalogCoverageAtK: 0,
    meanPairwiseOverlapAtK: 1,
    p95RerankLatencyMs: null,
  });
  assert.deepEqual(failures, [
    "meanNdcgAtK",
    "meanRecallAtK",
    "catalogCoverageAtK",
    "meanPairwiseOverlapAtK",
  ]);
});
