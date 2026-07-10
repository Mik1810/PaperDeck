import type { InteractionType, Paper } from "@/types/paper";

export type RankingTopic = {
  id: string;
  parentId: string | null;
};

export type RankingInteraction = {
  paperId: string;
  action: InteractionType;
};

export type UserPaperRankingState = {
  seenIds: Set<string>;
  interactions: RankingInteraction[];
};

export type RankingScoreComponents = {
  semantic: number;
  topic: number;
  feedback: number;
  citation: number;
  recency: number;
  classic: number;
  total: number;
  source: "live" | "initial_batch";
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

const feedHiddenActions = new Set<InteractionType>([
  "open_detail",
  "dismiss",
  "not_interested",
  "read",
  "already_read",
  "save_to_playlist",
  "favorite",
]);

export function isFeedHiddenAction(action: InteractionType) {
  return feedHiddenActions.has(action);
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

function buildTopicAffinity(
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

function buildFeedbackTopicWeights(
  papers: Paper[],
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

function scorePaper(paper: Paper, context: RankingContext): RankingScoreComponents {
  const semanticScore = (context.semanticScores?.get(paper.id) ?? 0) * 120;
  const topicScore = paper.topics.reduce(
    (score, topic) => score + (context.topicAffinity.get(topic.id) ?? 0) * 90,
    0,
  );
  const feedbackScore = paper.topics.reduce(
    (score, topic) =>
      score + (context.feedbackTopicWeights.get(topic.id) ?? 0) * 6,
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
    source: "live",
  };
}

function buildPersonalizedReason(paper: Paper, context: RankingContext) {
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

export function rankFeedPapers(
  papers: Paper[],
  topics: RankingTopic[],
  selectedTopicIds: Set<string>,
  state: UserPaperRankingState,
  semanticScores?: Map<string, number>,
) {
  const context: RankingContext = {
    topicAffinity: buildTopicAffinity(selectedTopicIds, topics),
    feedbackTopicWeights: buildFeedbackTopicWeights(papers, state.interactions),
    semanticScores,
  };

  return papers
    .filter((paper) => !state.seenIds.has(paper.id))
    .map(
      (paper): RankedPaper => {
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
