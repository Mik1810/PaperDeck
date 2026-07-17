import {
  FEED_RANKER_VERSION,
  rankFeedPapers,
  type RankingInteraction,
  type RankingTopic,
} from "./feed-ranking";
import type { Paper } from "../../types/paper";

export const RECOMMENDATION_STABILITY_FIXTURE_VERSION =
  "paperdeck-recommendation-stability-v1";

export const RECOMMENDATION_STABILITY_THRESHOLDS = {
  meanNdcgAtK: 0.9,
  meanRecallAtK: 0.75,
  catalogCoverageAtK: 0.8,
  maxMeanPairwiseOverlapAtK: 0.25,
} as const;

export const RECOMMENDATION_RERANK_LATENCY_REFERENCE_MS = 25;

export type RecommendationEvaluationScenario = {
  id: string;
  papers: Paper[];
  topics: RankingTopic[];
  selectedTopicIds: string[];
  seenPaperIds?: string[];
  interactions?: RankingInteraction[];
  semanticScores?: Record<string, number>;
  relevantPaperIds: string[];
};

export type RecommendationStabilityMetrics = {
  rankerVersion: string;
  fixtureVersion: string;
  topK: number;
  scenarioCount: number;
  meanNdcgAtK: number;
  meanRecallAtK: number;
  catalogCoverageAtK: number;
  meanPairwiseOverlapAtK: number;
  p95RerankLatencyMs: number | null;
};

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ndcgAtK(ids: string[], relevantIds: Set<string>, topK: number) {
  const gains = ids.slice(0, topK).map((id, index) =>
    relevantIds.has(id) ? 1 / Math.log2(index + 2) : 0,
  );
  const idealCount = Math.min(relevantIds.size, topK);
  const ideal = Array.from(
    { length: idealCount },
    (_, index) => 1 / Math.log2(index + 2),
  );
  return ideal.length
    ? gains.reduce((sum, gain) => sum + gain, 0) /
        ideal.reduce((sum, gain) => sum + gain, 0)
    : 0;
}

function recallAtK(ids: string[], relevantIds: Set<string>, topK: number) {
  if (!relevantIds.size) return 0;
  return ids.slice(0, topK).filter((id) => relevantIds.has(id)).length / relevantIds.size;
}

function percentile95(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? null;
}

function pairwiseOverlap(lists: string[][], topK: number) {
  const overlaps: number[] = [];
  for (let left = 0; left < lists.length; left += 1) {
    for (let right = left + 1; right < lists.length; right += 1) {
      const leftIds = new Set(lists[left].slice(0, topK));
      const shared = lists[right].slice(0, topK).filter((id) => leftIds.has(id));
      overlaps.push(shared.length / topK);
    }
  }
  return overlaps.length ? mean(overlaps) : 0;
}

function rankScenario(scenario: RecommendationEvaluationScenario) {
  return rankFeedPapers(
    scenario.papers,
    scenario.topics,
    new Set(scenario.selectedTopicIds),
    {
      seenIds: new Set(scenario.seenPaperIds ?? []),
      interactions: scenario.interactions ?? [],
    },
    scenario.semanticScores
      ? new Map(Object.entries(scenario.semanticScores))
      : undefined,
  );
}

export function evaluateRecommendationStability(
  scenarios: RecommendationEvaluationScenario[],
  options: { topK?: number; latencyIterations?: number } = {},
): RecommendationStabilityMetrics {
  if (!scenarios.length) throw new Error("At least one evaluation scenario is required");
  const topK = options.topK ?? 4;
  const rankings = scenarios.map((scenario) => rankScenario(scenario));
  const rankedIds = rankings.map((ranking) => ranking.map((paper) => paper.id));
  const eligibleIds = new Set(
    scenarios.flatMap((scenario) =>
      scenario.papers
        .filter((paper) => !(scenario.seenPaperIds ?? []).includes(paper.id))
        .map((paper) => paper.id),
    ),
  );
  const recommendedIds = new Set(rankedIds.flatMap((ids) => ids.slice(0, topK)));
  const latencySamples: number[] = [];

  for (let iteration = 0; iteration < (options.latencyIterations ?? 0); iteration += 1) {
    for (const scenario of scenarios) {
      const startedAt = performance.now();
      rankScenario(scenario);
      latencySamples.push(performance.now() - startedAt);
    }
  }

  return {
    rankerVersion: FEED_RANKER_VERSION,
    fixtureVersion: RECOMMENDATION_STABILITY_FIXTURE_VERSION,
    topK,
    scenarioCount: scenarios.length,
    meanNdcgAtK: mean(
      rankedIds.map((ids, index) =>
        ndcgAtK(ids, new Set(scenarios[index].relevantPaperIds), topK),
      ),
    ),
    meanRecallAtK: mean(
      rankedIds.map((ids, index) =>
        recallAtK(ids, new Set(scenarios[index].relevantPaperIds), topK),
      ),
    ),
    catalogCoverageAtK: eligibleIds.size ? recommendedIds.size / eligibleIds.size : 0,
    meanPairwiseOverlapAtK: pairwiseOverlap(rankedIds, topK),
    p95RerankLatencyMs: percentile95(latencySamples),
  };
}

export function recommendationStabilityFailures(
  metrics: RecommendationStabilityMetrics,
) {
  const failures: string[] = [];
  if (metrics.meanNdcgAtK < RECOMMENDATION_STABILITY_THRESHOLDS.meanNdcgAtK)
    failures.push("meanNdcgAtK");
  if (metrics.meanRecallAtK < RECOMMENDATION_STABILITY_THRESHOLDS.meanRecallAtK)
    failures.push("meanRecallAtK");
  if (metrics.catalogCoverageAtK < RECOMMENDATION_STABILITY_THRESHOLDS.catalogCoverageAtK)
    failures.push("catalogCoverageAtK");
  if (
    metrics.meanPairwiseOverlapAtK >
    RECOMMENDATION_STABILITY_THRESHOLDS.maxMeanPairwiseOverlapAtK
  )
    failures.push("meanPairwiseOverlapAtK");
  return failures;
}
