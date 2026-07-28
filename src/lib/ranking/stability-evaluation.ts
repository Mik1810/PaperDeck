import {
  FEED_RANKER_VERSION,
  rankFeedPapers,
  type RankingInteraction,
  type RankingTopic,
} from "./feed-ranking";
import type { Paper } from "../../types/paper";

export const RECOMMENDATION_SANITY_FIXTURE_VERSION =
  "paperdeck-recommendation-sanity-v1";
export const RECOMMENDATION_STABILITY_FIXTURE_VERSION =
  "paperdeck-recommendation-stability-v2";

export const RECOMMENDATION_SANITY_THRESHOLDS = {
  meanNdcgAtK: 1,
  minNdcgAtK: 1,
  meanRecallAtK: 1,
  minRecallAtK: 1,
  catalogExposureCoverageAtK: 1,
  maxMeanPairwiseOverlapAtK: 0,
  maxSeenLeakageCount: 0,
} as const;

export const RECOMMENDATION_STABILITY_THRESHOLDS = {
  meanNdcgAtK: 0.88,
  minNdcgAtK: 0.75,
  meanRecallAtK: 0.8,
  minRecallAtK: 0.65,
  catalogExposureCoverageAtK: 0.55,
  maxMeanPairwiseOverlapAtK: 0.35,
  maxSeenLeakageCount: 0,
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
  relevanceGrades: Record<string, number>;
};

export type RecommendationScenarioMetrics = {
  scenarioId: string;
  ndcgAtK: number;
  recallAtK: number;
  seenLeakageCount: number;
};

export type RecommendationStabilityMetrics = {
  rankerVersion: string;
  fixtureVersion: string;
  topK: number;
  scenarioCount: number;
  meanNdcgAtK: number;
  minNdcgAtK: number;
  meanRecallAtK: number;
  minRecallAtK: number;
  catalogExposureCoverageAtK: number;
  meanPairwiseOverlapAtK: number;
  seenLeakageCount: number;
  scenarios: RecommendationScenarioMetrics[];
  p95RerankLatencyMs: number | null;
};

export type RecommendationStabilityThresholds = {
  meanNdcgAtK: number;
  minNdcgAtK: number;
  meanRecallAtK: number;
  minRecallAtK: number;
  catalogExposureCoverageAtK: number;
  maxMeanPairwiseOverlapAtK: number;
  maxSeenLeakageCount: number;
};

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ndcgAtK(
  ids: string[],
  relevanceGrades: Record<string, number>,
  topK: number,
) {
  const gains = ids.slice(0, topK).map(
    (id, index) => (relevanceGrades[id] ?? 0) / Math.log2(index + 2),
  );
  const ideal = Object.values(relevanceGrades)
    .filter((grade) => grade > 0)
    .sort((left, right) => right - left)
    .slice(0, topK)
    .map((grade, index) => grade / Math.log2(index + 2));
  return ideal.length
    ? gains.reduce((sum, gain) => sum + gain, 0) /
        ideal.reduce((sum, gain) => sum + gain, 0)
    : 0;
}

function recallAtK(
  ids: string[],
  relevanceGrades: Record<string, number>,
  topK: number,
) {
  const relevantIds = new Set(
    Object.entries(relevanceGrades)
      .filter(([, grade]) => grade > 0)
      .map(([id]) => id),
  );
  if (!relevantIds.size) return 0;
  return (
    ids.slice(0, topK).filter((id) => relevantIds.has(id)).length /
    relevantIds.size
  );
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
  options: {
    topK?: number;
    latencyIterations?: number;
    fixtureVersion?: string;
  } = {},
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
  const scenarioMetrics = rankedIds.map((ids, index) => {
    const scenario = scenarios[index];
    const seenIds = new Set(scenario.seenPaperIds ?? []);
    return {
      scenarioId: scenario.id,
      ndcgAtK: ndcgAtK(ids, scenario.relevanceGrades, topK),
      recallAtK: recallAtK(ids, scenario.relevanceGrades, topK),
      seenLeakageCount: ids
        .slice(0, topK)
        .filter((id) => seenIds.has(id)).length,
    };
  });
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
    fixtureVersion:
      options.fixtureVersion ?? RECOMMENDATION_STABILITY_FIXTURE_VERSION,
    topK,
    scenarioCount: scenarios.length,
    meanNdcgAtK: mean(scenarioMetrics.map((metrics) => metrics.ndcgAtK)),
    minNdcgAtK: Math.min(
      ...scenarioMetrics.map((metrics) => metrics.ndcgAtK),
    ),
    meanRecallAtK: mean(scenarioMetrics.map((metrics) => metrics.recallAtK)),
    minRecallAtK: Math.min(
      ...scenarioMetrics.map((metrics) => metrics.recallAtK),
    ),
    catalogExposureCoverageAtK: eligibleIds.size
      ? recommendedIds.size / eligibleIds.size
      : 0,
    meanPairwiseOverlapAtK: pairwiseOverlap(rankedIds, topK),
    seenLeakageCount: scenarioMetrics.reduce(
      (total, metrics) => total + metrics.seenLeakageCount,
      0,
    ),
    scenarios: scenarioMetrics,
    p95RerankLatencyMs: percentile95(latencySamples),
  };
}

export function recommendationStabilityFailures(
  metrics: RecommendationStabilityMetrics,
  thresholds: RecommendationStabilityThresholds,
) {
  const failures: string[] = [];
  if (metrics.meanNdcgAtK < thresholds.meanNdcgAtK)
    failures.push("meanNdcgAtK");
  if (metrics.minNdcgAtK < thresholds.minNdcgAtK)
    failures.push("minNdcgAtK");
  if (metrics.meanRecallAtK < thresholds.meanRecallAtK)
    failures.push("meanRecallAtK");
  if (metrics.minRecallAtK < thresholds.minRecallAtK)
    failures.push("minRecallAtK");
  if (
    metrics.catalogExposureCoverageAtK <
    thresholds.catalogExposureCoverageAtK
  )
    failures.push("catalogExposureCoverageAtK");
  if (
    metrics.meanPairwiseOverlapAtK >
    thresholds.maxMeanPairwiseOverlapAtK
  )
    failures.push("meanPairwiseOverlapAtK");
  if (metrics.seenLeakageCount > thresholds.maxSeenLeakageCount)
    failures.push("seenLeakageCount");
  return failures;
}
