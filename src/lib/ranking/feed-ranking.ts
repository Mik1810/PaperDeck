import type { InteractionType, Paper } from "@/types/paper";

export const FEED_RANKER_VERSION = "paperdeck-hybrid-ranker-v1";

export type RankingTopic = {
  id: string;
  parentId: string | null;
};

export type RankingInteraction = {
  paperId: string;
  action: InteractionType;
};

export type RankingPaperCandidate = Pick<
  Paper,
  "id" | "year" | "citationCount" | "isClassic" | "topics"
>;

export type UserPaperRankingState = {
  seenIds: Set<string>;
  interactions: RankingInteraction[];
};

export type RecommendationCandidateSource =
  | "semantic"
  | "catalog_fallback";

export function isRecommendationCandidateSource(
  value: string | null | undefined,
): value is RecommendationCandidateSource {
  return value === "semantic" || value === "catalog_fallback";
}

export type RankingScoreComponents = {
  semantic: number;
  topic: number;
  feedback: number;
  citation: number;
  recency: number;
  classic: number;
  total: number;
  source: RecommendationCandidateSource | "initial_batch" | "live_batch";
};

export type RankedPaper = Paper & {
  rankingScore: number;
  rankingScoreComponents: RankingScoreComponents;
};

type RankingContext = {
  topicAffinity: Map<string, number>;
  feedbackTopicWeights: Map<string, number>;
  semanticScores?: Map<string, number>;
};

const positiveInteractionWeights: Partial<Record<InteractionType, number>> = {
  open_detail: 2,
  favorite: 6,
  save_to_playlist: 5,
  read: 3,
  already_read: 3,
};

const negativeInteractionWeights: Partial<Record<InteractionType, number>> = {
  dismiss: -5,
  not_interested: -7,
};

const durableFeedExclusionActions = new Set<InteractionType>([
  "open_detail",
  "dismiss",
  "not_interested",
  "read",
  "already_read",
]);

const TOPIC_AFFINITY_SCORE_MULTIPLIER = 90;
const FEEDBACK_SCORE_MULTIPLIER = 6;

export function isDurableFeedExclusionAction(action: InteractionType) {
  return durableFeedExclusionActions.has(action);
}

export function isRankingFeedbackAction(action: InteractionType) {
  return Boolean(
    positiveInteractionWeights[action] ?? negativeInteractionWeights[action],
  );
}

export function buildSeenPaperIds(
  favoriteIds: Iterable<string>,
  playlistPaperIds: Iterable<string>,
  durableExclusionIds: Iterable<string>,
) {
  return new Set([
    ...favoriteIds,
    ...playlistPaperIds,
    ...durableExclusionIds,
  ]);
}

function getAncestorIds(
  topicId: string,
  parentByTopicId: Map<string, string | null>,
) {
  const ancestors: string[] = [];
  let parentId = parentByTopicId.get(topicId) ?? null;

  while (parentId) {
    ancestors.push(parentId);
    parentId = parentByTopicId.get(parentId) ?? null;
  }

  return ancestors;
}

export function buildTopicAffinity(
  selectedTopicIds: Set<string>,
  topics: RankingTopic[],
) {
  const parentByTopicId = new Map(
    topics.map((topic) => [topic.id, topic.parentId]),
  );
  const selectedAncestors = new Set(
    [...selectedTopicIds].flatMap((topicId) =>
      getAncestorIds(topicId, parentByTopicId),
    ),
  );
  const topicAffinity = new Map<string, number>();

  for (const topic of topics) {
    const ancestors = getAncestorIds(topic.id, parentByTopicId);

    if (selectedTopicIds.has(topic.id)) {
      topicAffinity.set(topic.id, 1);
    } else if (ancestors.some((ancestorId) => selectedTopicIds.has(ancestorId))) {
      topicAffinity.set(topic.id, 0.75);
    } else if (selectedAncestors.has(topic.id)) {
      topicAffinity.set(topic.id, 0.5);
    }
  }

  return topicAffinity;
}

function clampScore(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function buildFeedbackTopicWeights(
  papers: RankingPaperCandidate[],
  interactions: RankingInteraction[],
) {
  const papersById = new Map(papers.map((paper) => [paper.id, paper]));
  const weights = new Map<string, number>();

  for (const interaction of interactions) {
    const weight =
      positiveInteractionWeights[interaction.action] ??
      negativeInteractionWeights[interaction.action] ??
      0;

    if (!weight) {
      continue;
    }

    const paper = papersById.get(interaction.paperId);

    if (!paper) {
      continue;
    }

    for (const topic of paper.topics) {
      const nextWeight = (weights.get(topic.id) ?? 0) + weight;
      weights.set(topic.id, clampScore(nextWeight, -12, 18));
    }
  }

  return weights;
}

export function buildCandidateTopicWeights(
  papers: RankingPaperCandidate[],
  topics: RankingTopic[],
  selectedTopicIds: Set<string>,
  interactions: RankingInteraction[],
) {
  const affinity = buildTopicAffinity(selectedTopicIds, topics);
  const feedback = buildFeedbackTopicWeights(papers, interactions);
  const topicIds = new Set([...affinity.keys(), ...feedback.keys()]);

  return new Map(
    [...topicIds].map((topicId) => [
      topicId,
      (affinity.get(topicId) ?? 0) * TOPIC_AFFINITY_SCORE_MULTIPLIER
        + (feedback.get(topicId) ?? 0) * FEEDBACK_SCORE_MULTIPLIER,
    ]),
  );
}

function scorePaper(
  paper: RankingPaperCandidate,
  context: RankingContext,
): RankingScoreComponents {
  const semanticScore = (context.semanticScores?.get(paper.id) ?? 0) * 120;
  const topicScore = paper.topics.reduce(
    (score, topic) =>
      score
      + (context.topicAffinity.get(topic.id) ?? 0)
        * TOPIC_AFFINITY_SCORE_MULTIPLIER,
    0,
  );
  const feedbackScore = paper.topics.reduce(
    (score, topic) =>
      score
      + (context.feedbackTopicWeights.get(topic.id) ?? 0)
        * FEEDBACK_SCORE_MULTIPLIER,
    0,
  );
  const citationScore = Math.log1p(paper.citationCount ?? 0) * 2;
  const recencyScore = Math.max(0, (paper.year ?? 2020) - 2020) * 0.4;
  const classicScore = paper.isClassic ? 2 : 0;
  const total =
    semanticScore +
    topicScore +
    feedbackScore +
    citationScore +
    recencyScore +
    classicScore;

  return {
    semantic: semanticScore,
    topic: topicScore,
    feedback: feedbackScore,
    citation: citationScore,
    recency: recencyScore,
    classic: classicScore,
    total,
    source: context.semanticScores?.has(paper.id)
      ? "semantic"
      : "catalog_fallback",
  };
}

function buildPersonalizedReason(
  paper: RankingPaperCandidate,
  context: RankingContext,
) {
  const semanticScore = context.semanticScores?.get(paper.id) ?? 0;
  const affinityTopics = paper.topics.filter((topic) =>
    context.topicAffinity.has(topic.id),
  );
  const feedbackTopics = paper.topics.filter(
    (topic) => (context.feedbackTopicWeights.get(topic.id) ?? 0) > 0,
  );

  if (affinityTopics.length) {
    const labels = affinityTopics.slice(0, 2).map((topic) => topic.label);

    return `Matches your ${labels.join(" and ")} interests.`;
  }

  if (feedbackTopics.length) {
    const labels = feedbackTopics.slice(0, 2).map((topic) => topic.label);

    return `Ranked higher because of your recent ${labels.join(" and ")} feedback.`;
  }

  if (semanticScore > 0) {
    return "Semantically close to your current reading profile.";
  }

  if (paper.isClassic) {
    return "Classic paper kept as a small part of the discovery mix.";
  }

  return "Exploratory recommendation from the current CS catalog.";
}

export type RankedPaperCandidate<TPaper extends RankingPaperCandidate> = TPaper & {
  recommendationReason: string;
  rankingScore: number;
  rankingScoreComponents: RankingScoreComponents;
};

export function rankFeedCandidates<TPaper extends RankingPaperCandidate>(
  papers: TPaper[],
  topics: RankingTopic[],
  selectedTopicIds: Set<string>,
  state: UserPaperRankingState,
  semanticScores?: Map<string, number>,
): Array<RankedPaperCandidate<TPaper>> {
  const context: RankingContext = {
    topicAffinity: buildTopicAffinity(selectedTopicIds, topics),
    feedbackTopicWeights: buildFeedbackTopicWeights(papers, state.interactions),
    semanticScores,
  };

  return papers
    .filter((paper) => !state.seenIds.has(paper.id))
    .map(
      (paper): RankedPaperCandidate<TPaper> => {
        const scoreComponents = scorePaper(paper, context);

        return {
          ...paper,
          recommendationReason: buildPersonalizedReason(paper, context),
          rankingScore: scoreComponents.total,
          rankingScoreComponents: scoreComponents,
        };
      },
    )
    .sort((a, b) => b.rankingScore - a.rankingScore);
}

export function rankFeedPapers(
  papers: Paper[],
  topics: RankingTopic[],
  selectedTopicIds: Set<string>,
  state: UserPaperRankingState,
  semanticScores?: Map<string, number>,
): RankedPaper[] {
  return rankFeedCandidates(
    papers,
    topics,
    selectedTopicIds,
    state,
    semanticScores,
  );
}
