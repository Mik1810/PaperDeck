import "server-only";

import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { and, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  profiles,
  playlists,
  playlistItems,
  papers,
  paperNotes,
  recommendationImpressions,
  recommendations,
  userInterests,
  favorites,
  userPaperInteractions,
} from "@/db/schema";
import {
  buildSeenPaperIds,
  isRecommendationCandidateSource,
  rankFeedPapers,
  type RankedPaper,
  type RankingInteraction,
} from "@/lib/ranking/feed-ranking";
import { getAllPapers, getPapersByIds, getTopics } from "@/lib/repositories/catalog";
import { topicDisplayLabel } from "@/lib/arxiv-categories";
import { isDefaultOnboardingTopic } from "@/lib/topic-taxonomy";
import {
  INITIAL_FEED_RECOMMENDATION_COUNT,
  INITIAL_FEED_RECOMMENDATION_MODEL_VERSION,
  LIVE_FEED_RECOMMENDATION_MODEL_VERSION,
  isFreshRecommendationBatch,
  isUsableRecommendationBatchSize,
  needsCatalogRecommendationFill,
  recommendationModelVersionForFeedSource,
  type RecommendationFeedSource,
} from "@/lib/recommendation-batches";
import {
  addToOwnedPlaylist,
  removeFromOwnedPlaylist,
  reorderOwnedPlaylistItems,
} from "@/lib/repositories/playlist-items";
import { logger } from "@/lib/logging/logger";
import {
  getSemanticPaperCandidates,
  type SemanticRetrievalDiagnostics,
  type SemanticRetrievalFallbackReason,
} from "@/lib/repositories/semantic-retrieval";
import type { AuthenticatedUserContext } from "@/lib/auth/session";
import type { FeedPaper, InteractionType, Paper, Playlist } from "@/types/paper";

type TopicRow = Awaited<ReturnType<typeof getTopics>>[number];

type UserPaperState = {
  favoriteIds: Set<string>;
  readLaterIds: Set<string>;
  seenIds: Set<string>;
  interactions: RankingInteraction[];
};

type InteractionRecordOptions = {
  recommendationImpressionId?: string | null;
};

type RecommendationImpressionBatch = {
  batchId: string | null;
  impressionIdsByPaperId: Map<string, string>;
};

type RecommendationBatchSource = "initial_batch" | "live_batch";

type RankedFeedData = {
  rankedPapers: RankedPaper[];
  feedState: FeedState;
  timings: Record<string, number>;
  source: RecommendationFeedSource;
  liveBatchToCache: RankedPaper[];
};

const ignoredInteractionActions = ["dismiss", "not_interested"] as const;

type IgnoredInteractionAction = (typeof ignoredInteractionActions)[number];

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PaperPlaylistOption = {
  id: string;
  name: string;
  isDefault: boolean;
  selected: boolean;
};

export type PlaylistSaveContext = "feed" | "digest" | "paper_detail";

async function measureAsync<T>(
  timings: Record<string, number>,
  label: string,
  task: Promise<T>,
) {
  const startedAt = performance.now();
  const result = await task;
  timings[label] = Math.round(performance.now() - startedAt);

  return result;
}

function measureSync<T>(
  timings: Record<string, number>,
  label: string,
  task: () => T,
) {
  const startedAt = performance.now();
  const result = task();
  timings[label] = Math.round(performance.now() - startedAt);

  return result;
}

function isUuid(value: string) {
  return uuidPattern.test(value);
}

async function recordRecommendationImpressions(
  ownerId: string,
  papers: RankedPaper[],
  modelVersion: string,
): Promise<RecommendationImpressionBatch> {
  if (!papers.length) {
    return {
      batchId: null,
      impressionIdsByPaperId: new Map(),
    };
  }

  const batchId = randomUUID();
  const shownAt = new Date().toISOString();
  const rows = await db
    .insert(recommendationImpressions)
    .values(
      papers.map((paper, index) => ({
        ownerId,
        paperId: paper.id,
        batchId,
        rank: index + 1,
        score: paper.rankingScore,
        scoreComponents: paper.rankingScoreComponents,
        modelVersion,
        shownAt,
      })),
    )
    .returning({
      id: recommendationImpressions.id,
      paperId: recommendationImpressions.paperId,
    });

  return {
    batchId,
    impressionIdsByPaperId: new Map(
      rows.map((row) => [row.paperId, row.id]),
    ),
  };
}

export async function resolveRecommendationImpressionId(
  ownerId: string,
  paperId: string,
  recommendationImpressionId: string | null | undefined,
) {
  if (!recommendationImpressionId || !isUuid(recommendationImpressionId)) {
    return null;
  }

  const rows = await db
    .select({ id: recommendationImpressions.id })
    .from(recommendationImpressions)
    .where(
      and(
        eq(recommendationImpressions.id, recommendationImpressionId),
        eq(recommendationImpressions.ownerId, ownerId),
        eq(recommendationImpressions.paperId, paperId),
      ),
    )
    .limit(1);

  return rows[0]?.id ?? null;
}

/** @user-scoped Reads and writes user-owned profile data. */
export async function ensureUserProfile(user: AuthenticatedUserContext) {
  const now = new Date().toISOString();

  await db
    .insert(profiles)
    .values({
      ownerId: user.ownerId,
      displayName: user.displayName,
      imageUrl: user.imageUrl,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: profiles.ownerId,
      set: {
        imageUrl: user.imageUrl,
        updatedAt: now,
      },
    });

  await ensureReadLaterPlaylist(user.ownerId);
}

/** @user-scoped Creates a minimal profile for an owner id. */
export async function ensureUserProfileForOwner(ownerId: string) {
  await db
    .insert(profiles)
    .values({ ownerId })
    .onConflictDoNothing({ target: profiles.ownerId });
}

async function findReadLaterPlaylistId(ownerId: string) {
  const rows = await db
    .select({ id: playlists.id })
    .from(playlists)
    .where(and(eq(playlists.ownerId, ownerId), eq(playlists.name, "Read later")))
    .limit(1);

  return rows[0]?.id;
}

/** @user-scoped Ensures the default Read later playlist exists. */
export async function ensureReadLaterPlaylist(ownerId: string) {
  const [created] = await db
    .insert(playlists)
    .values({
      ownerId,
      name: "Read later",
      description: "Default private queue for papers to revisit.",
      isDefault: true,
    })
    .onConflictDoNothing({ target: [playlists.ownerId, playlists.name] })
    .returning({ id: playlists.id });

  if (created) {
    return created.id;
  }

  const existingId = await findReadLaterPlaylistId(ownerId);

  if (!existingId) {
    throw new Error("Find Read later playlist after conflict: missing saved row");
  }

  return existingId;
}

/** @user-scoped */
export async function getSelectedTopicIds(ownerId: string) {
  const rows = await db
    .select({ topicId: userInterests.topicId })
    .from(userInterests)
    .where(eq(userInterests.ownerId, ownerId));

  return new Set(rows.map((r) => r.topicId));
}

/** @user-scoped */
export async function hasUsableOnboardingState(ownerId: string) {
  const rows = await db
    .select({
      onboardingCompletedAt: profiles.onboardingCompletedAt,
      hasInterests: sql<boolean>`exists (
        select 1
        from ${userInterests}
        where ${userInterests.ownerId} = ${ownerId}
      )`,
    })
    .from(profiles)
    .where(eq(profiles.ownerId, ownerId))
    .limit(1);

  return Boolean(
    rows[0]?.onboardingCompletedAt || rows[0]?.hasInterests,
  );
}

function userInterestFromTopic(topic: TopicRow, selectedTopicIds: Set<string>) {
  return {
    id: topic.id,
    arxivCategory: topic.arxivCategory,
    depth: topic.depth,
    label: topicDisplayLabel({
      arxivCategory: topic.arxivCategory,
      label: topic.label,
    }),
    parentId: topic.parentId,
    selected: selectedTopicIds.has(topic.id),
    slug: topic.slug,
    source: topic.source,
  };
}

/** @user-scoped */
export async function saveSelectedTopics(ownerId: string, topicIds: string[]) {
  const uniqueTopicIds = [...new Set(topicIds)];
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx
      .delete(userInterests)
      .where(eq(userInterests.ownerId, ownerId));

    if (uniqueTopicIds.length) {
      await tx.insert(userInterests).values(
        uniqueTopicIds.map((topicId) => ({
          ownerId,
          topicId,
          weight: 1,
        })),
      );
    }

    await tx
      .update(profiles)
      .set({
        onboardingCompletedAt: now,
        updatedAt: now,
      })
      .where(eq(profiles.ownerId, ownerId));
  });
}

/** @admin */
export async function getDefaultOnboardingTopicIds() {
  const topics = await getTopics();

  return topics
    .filter((topic: TopicRow) => isDefaultOnboardingTopic(topic))
    .map((topic: TopicRow) => topic.id);
}

/** @user-scoped */
export async function getOnboardingData(ownerId: string) {
  const [topics, feedState] = await Promise.all([
    getTopics(),
    getFeedState(ownerId),
  ]);

  return {
    topics: topics.map((topic: TopicRow) =>
      userInterestFromTopic(topic, feedState.selectedTopicIds),
    ),
    selectedTopicIds: feedState.selectedTopicIds,
  };
}

type FeedState = {
  selectedTopicIds: Set<string>;
  userState: UserPaperState;
};

type LiveRankedFeedResult = {
  catalogFillCount: number;
  rankedPapers: RankedPaper[];
  semanticDiagnostics: SemanticRetrievalDiagnostics;
  semanticFallbackReason:
    | SemanticRetrievalFallbackReason
    | "insufficient_unseen_candidates"
    | "ranker_filtered_all"
    | null;
};

async function getFeedState(ownerId: string): Promise<FeedState> {
  const [
    interests,
    favRows,
    rlPlaylist,
    interactionRows,
  ] = await Promise.all([
    db
      .select({ topicId: userInterests.topicId })
      .from(userInterests)
      .where(eq(userInterests.ownerId, ownerId)),
    db
      .select({ paperId: favorites.paperId })
      .from(favorites)
      .where(eq(favorites.ownerId, ownerId)),
    (async () => {
      const playlistId = await findReadLaterPlaylistId(ownerId);
      if (!playlistId) return [] as Array<{ paperId: string }>;
      return db
        .select({ paperId: playlistItems.paperId })
        .from(playlistItems)
        .where(eq(playlistItems.playlistId, playlistId));
    })(),
    db
      .select({
        paperId: userPaperInteractions.paperId,
        action: userPaperInteractions.action,
      })
      .from(userPaperInteractions)
      .where(eq(userPaperInteractions.ownerId, ownerId))
      .orderBy(desc(userPaperInteractions.createdAt))
      .limit(200),
  ]);

  const favoriteIds = new Set(favRows.map((r) => r.paperId));
  const readLaterIds = new Set(rlPlaylist.map((r) => r.paperId));

  return {
    selectedTopicIds: new Set(interests.map((r) => r.topicId)),
    userState: {
      favoriteIds,
      readLaterIds,
      seenIds: buildSeenPaperIds(
        favoriteIds,
        readLaterIds,
        interactionRows,
      ),
      interactions: interactionRows,
    },
  };
}

async function buildLiveRankedFeed(
  ownerId: string,
  topics: TopicRow[],
  feedState: FeedState,
  timings: Record<string, number>,
): Promise<LiveRankedFeedResult> {
  const selectedTopicIds = feedState.selectedTopicIds;
  const state = feedState.userState;
  const semanticCandidates = await measureAsync(
    timings,
    "semantic_retrieval",
    getSemanticPaperCandidates(ownerId),
  );
  const hasSemanticCandidates = semanticCandidates.papers.length > 0;
  const papers = hasSemanticCandidates
    ? semanticCandidates.papers
    : await measureAsync(timings, "paper_loading", getAllPapers());

  let rankedPapers = measureSync(timings, "ranking", () =>
    rankFeedPapers(
      papers,
      topics,
      selectedTopicIds,
      state,
      semanticCandidates.semanticScores,
    ),
  );

  let semanticFallbackReason: LiveRankedFeedResult["semanticFallbackReason"] =
    semanticCandidates.diagnostics.fallbackReason;

  if (
    hasSemanticCandidates &&
    needsCatalogRecommendationFill(rankedPapers.length)
  ) {
    semanticFallbackReason = rankedPapers.length
      ? "insufficient_unseen_candidates"
      : "ranker_filtered_all";
    const fallbackPapers = await measureAsync(
      timings,
      "fallback_paper_loading",
      getAllPapers(),
    );
    rankedPapers = measureSync(timings, "fallback_ranking", () =>
      rankFeedPapers(
        fallbackPapers,
        topics,
        selectedTopicIds,
        state,
        semanticCandidates.semanticScores,
      ),
    );
  }

  return {
    catalogFillCount: rankedPapers
      .slice(0, INITIAL_FEED_RECOMMENDATION_COUNT)
      .filter(
        (paper) =>
          paper.rankingScoreComponents.source === "catalog_fallback",
      ).length,
    rankedPapers,
    semanticDiagnostics: semanticCandidates.diagnostics,
    semanticFallbackReason,
  };
}

async function getLatestInitialRecommendationBatch(
  ownerId: string,
  state: UserPaperState,
  limit = INITIAL_FEED_RECOMMENDATION_COUNT,
) {
  return getLatestRecommendationBatch({
    limit,
    modelVersion: INITIAL_FEED_RECOMMENDATION_MODEL_VERSION,
    ownerId,
    source: "initial_batch",
    state,
  });
}

async function getLatestLiveRecommendationBatch(
  ownerId: string,
  state: UserPaperState,
  limit = INITIAL_FEED_RECOMMENDATION_COUNT,
) {
  return getLatestRecommendationBatch({
    limit,
    modelVersion: LIVE_FEED_RECOMMENDATION_MODEL_VERSION,
    ownerId,
    source: "live_batch",
    state,
  });
}

async function getLatestRecommendationBatch({
  ownerId,
  state,
  modelVersion,
  source,
  limit = INITIAL_FEED_RECOMMENDATION_COUNT,
}: {
  ownerId: string;
  state: UserPaperState;
  modelVersion: string;
  source: RecommendationBatchSource;
  limit?: number;
}) {
  const latest = await db
    .select({ generatedAt: recommendations.generatedAt })
    .from(recommendations)
    .where(
      and(
        eq(recommendations.ownerId, ownerId),
        eq(recommendations.modelVersion, modelVersion),
      ),
    )
    .orderBy(desc(recommendations.generatedAt))
    .limit(1);

  if (
    !latest[0]?.generatedAt ||
    !isFreshRecommendationBatch(latest[0].generatedAt)
  ) {
    return [];
  }

  const recommendationRows = await db
    .select({
      candidateSource: recommendations.candidateSource,
      paperId: recommendations.paperId,
      reason: recommendations.reason,
      score: recommendations.score,
    })
    .from(recommendations)
    .where(
      and(
        eq(recommendations.ownerId, ownerId),
        eq(recommendations.modelVersion, modelVersion),
        eq(recommendations.generatedAt, latest[0].generatedAt),
      ),
    )
    .orderBy(desc(recommendations.score))
    .limit(limit);

  const visibleRows = recommendationRows.filter(
    (row) => !state.seenIds.has(row.paperId),
  );

  if (!visibleRows.length) {
    return [];
  }

  const papers = await getPapersByIds(visibleRows.map((row) => row.paperId));
  const papersById = new Map(papers.map((paper) => [paper.id, paper]));

  return visibleRows
    .map((row): RankedPaper | null => {
      const paper = papersById.get(row.paperId);

      if (!paper) {
        return null;
      }

      return {
        ...paper,
        recommendationReason: row.reason ?? paper.recommendationReason,
        rankingScore: row.score,
        rankingScoreComponents: {
          semantic: 0,
          topic: 0,
          feedback: 0,
          citation: 0,
          recency: 0,
          classic: 0,
          total: row.score,
          source: isRecommendationCandidateSource(row.candidateSource)
            ? row.candidateSource
            : source,
        },
      };
    })
    .filter((paper): paper is RankedPaper => paper !== null);
}

/** @user-scoped */
export async function clearFeedRecommendations(
  ownerId: string,
  modelVersions = [
    INITIAL_FEED_RECOMMENDATION_MODEL_VERSION,
    LIVE_FEED_RECOMMENDATION_MODEL_VERSION,
  ],
) {
  await db
    .delete(recommendations)
    .where(
      and(
        eq(recommendations.ownerId, ownerId),
        inArray(recommendations.modelVersion, modelVersions),
      ),
    );
}

/** @user-scoped */
export async function clearInitialFeedRecommendations(ownerId: string) {
  await clearFeedRecommendations(ownerId, [
    INITIAL_FEED_RECOMMENDATION_MODEL_VERSION,
  ]);
}

async function insertRecommendationBatch(
  ownerId: string,
  batch: RankedPaper[],
  modelVersion: string,
) {
  if (!batch.length) {
    return { generatedAt: null, storedCount: 0 };
  }

  const generatedAt = new Date().toISOString();

  await db.insert(recommendations).values(
    batch.map((paper) => ({
      candidateSource: isRecommendationCandidateSource(
        paper.rankingScoreComponents.source,
      )
        ? paper.rankingScoreComponents.source
        : null,
      ownerId,
      paperId: paper.id,
      score: paper.rankingScore,
      reason: paper.recommendationReason,
      modelVersion,
      generatedAt,
    })),
  );

  return { generatedAt, storedCount: batch.length };
}

async function replaceRecommendationBatch(
  ownerId: string,
  batch: RankedPaper[],
  modelVersion: string,
) {
  await clearFeedRecommendations(ownerId, [modelVersion]);
  return insertRecommendationBatch(ownerId, batch, modelVersion);
}

async function cacheLiveRecommendationBatch(
  ownerId: string,
  batch: RankedPaper[],
) {
  const result = await insertRecommendationBatch(
    ownerId,
    batch,
    LIVE_FEED_RECOMMENDATION_MODEL_VERSION,
  );

  if (result.generatedAt) {
    await db
      .delete(recommendations)
      .where(
        and(
          eq(recommendations.ownerId, ownerId),
          eq(recommendations.modelVersion, LIVE_FEED_RECOMMENDATION_MODEL_VERSION),
          lt(recommendations.generatedAt, result.generatedAt),
        ),
      );
  }

  return result;
}

/** @admin */
export async function preloadInitialFeedRecommendations(ownerId: string) {
  const startedAt = performance.now();
  const timings: Record<string, number> = {};
  const [topics, feedState] = await Promise.all([
    measureAsync(timings, "topics", getTopics()),
    measureAsync(timings, "feed_state", getFeedState(ownerId)),
  ]);
  const liveFeed = await buildLiveRankedFeed(ownerId, topics, feedState, timings);
  const batch = liveFeed.rankedPapers.slice(0, INITIAL_FEED_RECOMMENDATION_COUNT);

  const stored = await replaceRecommendationBatch(
    ownerId,
    batch,
    INITIAL_FEED_RECOMMENDATION_MODEL_VERSION,
  );

  logger.info("initial_feed_preload", {
    ownerId,
    totalMs: Math.round(performance.now() - startedAt),
    timings,
    rankedCount: liveFeed.rankedPapers.length,
    storedCount: stored.storedCount,
    semantic: {
      used: Boolean(
        liveFeed.semanticDiagnostics.candidateCount,
      ),
      requestedCount: liveFeed.semanticDiagnostics.requestedCount,
      rpcAttempted: liveFeed.semanticDiagnostics.rpcAttempted,
      matchedCount: liveFeed.semanticDiagnostics.matchedCount,
      candidateCount: liveFeed.semanticDiagnostics.candidateCount,
      model: liveFeed.semanticDiagnostics.model,
      fallbackReason: liveFeed.semanticFallbackReason,
      catalogFillCount: liveFeed.catalogFillCount,
    },
  });

  return {
    storedCount: stored.storedCount,
  };
}

async function getRankedFeedData(ownerId: string): Promise<RankedFeedData> {
  const timings: Record<string, number> = {};
  const [topics, feedState] = await Promise.all([
    measureAsync(timings, "topics", getTopics()),
    measureAsync(timings, "feed_state", getFeedState(ownerId)),
  ]);
  const state = feedState.userState;

  let rankedPapers = await measureAsync(
    timings,
    "initial_recommendation_batch",
    getLatestInitialRecommendationBatch(ownerId, state),
  );

  if (isUsableRecommendationBatchSize(rankedPapers.length)) {
    return {
      feedState,
      liveBatchToCache: [],
      rankedPapers,
      source: "initial_batch",
      timings,
    };
  }

  rankedPapers = await measureAsync(
    timings,
    "live_recommendation_batch",
    getLatestLiveRecommendationBatch(ownerId, state),
  );

  if (isUsableRecommendationBatchSize(rankedPapers.length)) {
    return {
      feedState,
      liveBatchToCache: [],
      rankedPapers,
      source: "live_batch",
      timings,
    };
  }

  const liveFeed = await buildLiveRankedFeed(ownerId, topics, feedState, timings);

  return {
    feedState,
    liveBatchToCache: liveFeed.rankedPapers.slice(
      0,
      INITIAL_FEED_RECOMMENDATION_COUNT,
    ),
    rankedPapers: liveFeed.rankedPapers,
    source: "live_rank",
    timings,
  };
}

/** @admin */
export async function getRankedFeedPapers(
  ownerId: string,
): Promise<RankedPaper[]> {
  return (await getRankedFeedData(ownerId)).rankedPapers;
}

/** @user-scoped */
export async function getFeedPageData(ownerId: string) {
  const startedAt = performance.now();
  const feedData = await getRankedFeedData(ownerId);
  const { rankedPapers, timings } = feedData;
  const visiblePapers = rankedPapers.slice(0, INITIAL_FEED_RECOMMENDATION_COUNT);
  const state = feedData.feedState.userState;
  const impressionBatch = await measureAsync(
    timings,
    "recommendation_impressions",
    recordRecommendationImpressions(
      ownerId,
      visiblePapers,
      recommendationModelVersionForFeedSource(feedData.source),
    ),
  );
  const feedPapers: FeedPaper[] = visiblePapers.map((paper) => ({
    ...paper,
    recommendationImpressionId:
      impressionBatch.impressionIdsByPaperId.get(paper.id),
  }));
  const candidateSourceCounts = Object.fromEntries(
    [...new Set(visiblePapers.map((paper) => paper.rankingScoreComponents.source))]
      .sort()
      .map((source) => [
        source,
        visiblePapers.filter(
          (paper) => paper.rankingScoreComponents.source === source,
        ).length,
      ]),
  );

  if (feedData.liveBatchToCache.length) {
    after(async () => {
      try {
        await cacheLiveRecommendationBatch(ownerId, feedData.liveBatchToCache);
      } catch (error) {
        logger.error("live_feed_recommendation_cache_failed", {
          ownerId,
          error,
        });
      }
    });
  }

  logger.info("feed_timing", {
    ownerId,
    totalMs: Math.round(performance.now() - startedAt),
    source: feedData.source,
    candidateSourceCounts,
    timings,
    rankedCount: rankedPapers.length,
    recommendationImpressionBatchId: impressionBatch.batchId,
    recommendationImpressionCount: impressionBatch.impressionIdsByPaperId.size,
  });

  return {
    activePaper: feedPapers[0] ?? null,
    nextPapers: feedPapers.slice(1),
    favoriteIds: state.favoriteIds,
    readLaterIds: state.readLaterIds,
    readLaterCount: state.readLaterIds.size,
  };
}

const DIGEST_PAPER_COUNT = 10;
const DIGEST_MIN_PAPER_COUNT = 3;
const DIGEST_RECENCY_WINDOWS_DAYS = [7, 14, 30];

export type DigestGroup = {
  topicLabel: string;
  papers: Paper[];
};

async function getRecentPaperIds(
  paperIds: string[],
  sinceDays: number,
): Promise<Set<string>> {
  if (!paperIds.length) {
    return new Set();
  }

  const since = new Date(
    Date.now() - sinceDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const rows = await db
    .select({ id: papers.id })
    .from(papers)
    .where(
      and(
        inArray(papers.id, paperIds),
        sql`coalesce(${papers.publishedAt}, ${papers.ingestedAt}) >= ${since}`,
      ),
    );

  return new Set(rows.map((row) => row.id));
}

/** @admin */
export async function getDigestPageData(ownerId: string) {
  const feedData = await getRankedFeedData(ownerId);
  const { rankedPapers } = feedData;
  const state = feedData.feedState.userState;
  const rankedById = new Map(rankedPapers.map((paper) => [paper.id, paper]));

  let recentPapers: RankedPaper[] = [];

  for (const windowDays of DIGEST_RECENCY_WINDOWS_DAYS) {
    const recentIds = await getRecentPaperIds(
      rankedPapers.map((paper) => paper.id),
      windowDays,
    );
    recentPapers = rankedPapers.filter((paper) => recentIds.has(paper.id));

    if (recentPapers.length >= DIGEST_MIN_PAPER_COUNT) {
      break;
    }
  }

  const selectedPapers = recentPapers.slice(0, DIGEST_PAPER_COUNT);

  const groupsByLabel = new Map<string, Paper[]>();
  for (const paper of selectedPapers) {
    const topicLabel = paper.topics[0]?.label ?? "General";
    const list = groupsByLabel.get(topicLabel) ?? [];
    list.push(paper);
    groupsByLabel.set(topicLabel, list);
  }

  const groups: DigestGroup[] = [...groupsByLabel.entries()]
    .map(([topicLabel, papersInGroup]) => ({ topicLabel, papers: papersInGroup }))
    .sort((a, b) => {
      const aScore = rankedById.get(a.papers[0].id)?.rankingScore ?? 0;
      const bScore = rankedById.get(b.papers[0].id)?.rankingScore ?? 0;
      return bScore - aScore;
    });

  return {
    groups,
    totalCount: selectedPapers.length,
    generatedAt: new Date().toISOString(),
    readLaterIds: state.readLaterIds,
    readLaterCount: state.readLaterIds.size,
  };
}

type IgnoredPaperHistoryRow = {
  paperId: string;
  ignoredAt: string;
  action: IgnoredInteractionAction;
};

async function getIgnoredPaperHistoryRows(
  ownerId: string,
  limit = 50,
): Promise<IgnoredPaperHistoryRow[]> {
  const rows = await db
    .select({
      paperId: userPaperInteractions.paperId,
      action: userPaperInteractions.action,
      ignoredAt: userPaperInteractions.createdAt,
    })
    .from(userPaperInteractions)
    .where(
      and(
        eq(userPaperInteractions.ownerId, ownerId),
        inArray(userPaperInteractions.action, ignoredInteractionActions),
      ),
    )
    .orderBy(desc(userPaperInteractions.createdAt))
    .limit(limit * 4);

  const latestByPaperId = new Map<
    string,
    { action: IgnoredInteractionAction; ignoredAt: string }
  >();

  for (const row of rows) {
    if (latestByPaperId.has(row.paperId)) {
      continue;
    }

    latestByPaperId.set(row.paperId, {
      action: row.action as IgnoredInteractionAction,
      ignoredAt: row.ignoredAt,
    });

    if (latestByPaperId.size >= limit) {
      break;
    }
  }

  return [...latestByPaperId].map(([paperId, ignored]) => ({
    paperId,
    ignoredAt: ignored.ignoredAt,
    action: ignored.action,
  }));
}

async function getLibraryCollectionSnapshot(ownerId: string) {
  const playlistRowsPromise = db
    .select({
      id: playlists.id,
      name: playlists.name,
      isDefault: playlists.isDefault,
    })
    .from(playlists)
    .where(eq(playlists.ownerId, ownerId))
    .orderBy(playlists.createdAt);

  const favoriteRowsPromise = db
    .select({ paperId: favorites.paperId })
    .from(favorites)
    .where(eq(favorites.ownerId, ownerId))
    .orderBy(desc(favorites.createdAt));

  const ignoredRowsPromise = getIgnoredPaperHistoryRows(ownerId);
  const [playlistRows, favoriteRows, ignoredRows] = await Promise.all([
    playlistRowsPromise,
    favoriteRowsPromise,
    ignoredRowsPromise,
  ]);

  const playlistIds = playlistRows.map((playlist) => playlist.id);

  const allPlaylistItems = playlistIds.length
    ? await db
        .select({
          playlistId: playlistItems.playlistId,
          paperId: playlistItems.paperId,
        })
        .from(playlistItems)
        .where(inArray(playlistItems.playlistId, playlistIds))
        .orderBy(
          playlistItems.playlistId,
          playlistItems.position,
          desc(playlistItems.addedAt),
        )
    : [];

  const paperIdsByPlaylist = new Map<string, string[]>();
  for (const item of allPlaylistItems) {
    const existing = paperIdsByPlaylist.get(item.playlistId);
    if (existing) {
      existing.push(item.paperId);
    } else {
      paperIdsByPlaylist.set(item.playlistId, [item.paperId]);
    }
  }

  const playlistSummaries: Playlist[] = playlistRows.map((playlist) => ({
    id: playlist.id,
    name: playlist.name,
    paperIds: paperIdsByPlaylist.get(playlist.id) ?? [],
    isDefault: playlist.isDefault ?? false,
  }));

  const readLaterPlaylist = playlistSummaries.find(
    (playlist) => playlist.isDefault,
  );

  return {
    playlists: playlistSummaries,
    favoritePaperIds: favoriteRows.map((row) => row.paperId),
    ignoredRows,
    readLaterPaperIds: readLaterPlaylist?.paperIds ?? [],
  };
}

export type LibraryBackgroundData = {
  favoritePaperIds: string[];
  ignoredItems: Array<{
    action: IgnoredInteractionAction;
    ignoredAt: string;
    paperId: string;
  }>;
  papers: Paper[];
};

/** @user-scoped */
export async function getLibraryInitialData(ownerId: string) {
  const snapshot = await getLibraryCollectionSnapshot(ownerId);
  const readLaterPapers = await getPapersByIds(snapshot.readLaterPaperIds);

  return {
    favoriteCount: snapshot.favoritePaperIds.length,
    ignoredCount: snapshot.ignoredRows.length,
    playlists: snapshot.playlists,
    readLaterPapers,
    readLaterCount: snapshot.readLaterPaperIds.length,
  };
}

/** @user-scoped */
export async function getLibraryBackgroundData(
  ownerId: string,
): Promise<LibraryBackgroundData> {
  const snapshot = await getLibraryCollectionSnapshot(ownerId);
  const readLaterIds = new Set(snapshot.readLaterPaperIds);
  const backgroundPaperIds = new Set<string>(snapshot.favoritePaperIds);

  for (const item of snapshot.ignoredRows) {
    backgroundPaperIds.add(item.paperId);
  }
  for (const playlist of snapshot.playlists) {
    if (playlist.isDefault) continue;
    for (const paperId of playlist.paperIds) backgroundPaperIds.add(paperId);
  }
  for (const paperId of readLaterIds) backgroundPaperIds.delete(paperId);

  return {
    favoritePaperIds: snapshot.favoritePaperIds,
    ignoredItems: snapshot.ignoredRows,
    papers: await getPapersByIds([...backgroundPaperIds]),
  };
}

/** @user-scoped */
export async function getSettingsPageData(ownerId: string) {
  const [topics, feedState] = await Promise.all([
    getTopics(),
    getFeedState(ownerId),
  ]);

  return {
    interests: topics.map((topic: TopicRow) =>
      userInterestFromTopic(topic, feedState.selectedTopicIds),
    ),
    readLaterCount: feedState.userState.readLaterIds.size,
  };
}

/** @user-scoped */
export async function getReadLaterCount(ownerId: string) {
  const readLaterPlaylist = await db
    .select({ id: playlists.id })
    .from(playlists)
    .where(
      and(
        eq(playlists.ownerId, ownerId),
        eq(playlists.name, "Read later"),
      ),
    )
    .limit(1);

  const playlistId = readLaterPlaylist[0]?.id;

  if (!playlistId) {
    return 0;
  }

  const readLaterCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(playlistItems)
    .where(eq(playlistItems.playlistId, playlistId));

  return Number(readLaterCount[0]?.count ?? 0);
}

/** @user-scoped */
export async function getPaperDetailData(ownerId: string, paperId: string) {
  const [papers, state, notes] = await Promise.all([
    getPapersByIds([paperId]),
    getPaperDetailState(ownerId, paperId),
    getPaperNotes(ownerId, paperId),
  ]);

  return {
    paper: papers[0] ?? null,
    isFavorite: state.isFavorite,
    isSaved: state.isSaved,
    readLaterCount: state.readLaterCount,
    notes,
  };
}

async function getPaperDetailState(ownerId: string, paperId: string) {
  const [favRow, rlPlaylist, savedRow] = await Promise.all([
    db
      .select({ paperId: favorites.paperId })
      .from(favorites)
      .where(
        and(
          eq(favorites.ownerId, ownerId),
          eq(favorites.paperId, paperId),
        ),
      )
      .limit(1),
    db
      .select({ id: playlists.id })
      .from(playlists)
      .where(
        and(
          eq(playlists.ownerId, ownerId),
          eq(playlists.name, "Read later"),
        ),
      )
      .limit(1),
    db
      .select({ paperId: playlistItems.paperId })
      .from(playlistItems)
      .innerJoin(playlists, eq(playlists.id, playlistItems.playlistId))
      .where(
        and(
          eq(playlists.ownerId, ownerId),
          eq(playlistItems.paperId, paperId),
        ),
      )
      .limit(1),
  ]);

  const playlistId = rlPlaylist[0]?.id;

  if (!playlistId) {
    return {
      isFavorite: favRow.length > 0,
      isSaved: savedRow.length > 0,
      readLaterCount: 0,
    };
  }

  const readLaterCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(playlistItems)
    .where(eq(playlistItems.playlistId, playlistId));

  return {
    isFavorite: favRow.length > 0,
    isSaved: savedRow.length > 0,
    readLaterCount: Number(readLaterCount[0]?.count ?? 0),
  };
}

export const PAPER_NOTE_MAX_LENGTH = 4000;

export type PaperNote = {
  id: string;
  body: string;
  playlistId: string | null;
  createdAt: string;
};

/** @user-scoped */
export async function getPaperNotes(
  ownerId: string,
  paperId: string,
): Promise<PaperNote[]> {
  return db
    .select({
      id: paperNotes.id,
      body: paperNotes.body,
      playlistId: paperNotes.playlistId,
      createdAt: paperNotes.createdAt,
    })
    .from(paperNotes)
    .where(
      and(eq(paperNotes.ownerId, ownerId), eq(paperNotes.paperId, paperId)),
    )
    .orderBy(desc(paperNotes.createdAt));
}

/** @user-scoped */
export async function addPaperNote(
  ownerId: string,
  paperId: string,
  body: string,
  playlistId: string | null = null,
) {
  const trimmed = body.trim().slice(0, PAPER_NOTE_MAX_LENGTH);

  if (!trimmed) {
    return;
  }

  await db.insert(paperNotes).values({
    ownerId,
    paperId,
    body: trimmed,
    playlistId,
  });
}

/** @user-scoped */
export async function deletePaperNote(
  ownerId: string,
  paperId: string,
  noteId: string,
) {
  await db
    .delete(paperNotes)
    .where(
      and(
        eq(paperNotes.ownerId, ownerId),
        eq(paperNotes.paperId, paperId),
        eq(paperNotes.id, noteId),
      ),
    );
}

/** @user-scoped */
export async function recordPaperInteraction(
  ownerId: string,
  paperId: string,
  action: InteractionType,
  context = "feed",
  options: InteractionRecordOptions = {},
) {
  await db.insert(userPaperInteractions).values({
    ownerId,
    paperId,
    recommendationImpressionId: options.recommendationImpressionId ?? null,
    action,
    context,
  });
}

/** @user-scoped */
export async function toggleFavorite(
  ownerId: string,
  paperId: string,
  options: InteractionRecordOptions = {},
) {
  const [created] = await db
    .insert(favorites)
    .values({ ownerId, paperId })
    .onConflictDoNothing({ target: [favorites.ownerId, favorites.paperId] })
    .returning({ paperId: favorites.paperId });

  if (created) {
    await recordPaperInteraction(ownerId, paperId, "favorite", "feed", options);
    return;
  }

  await db
    .delete(favorites)
    .where(
      and(
        eq(favorites.ownerId, ownerId),
        eq(favorites.paperId, paperId),
      ),
    );
}

/** @user-scoped */
export async function toggleReadLater(
  ownerId: string,
  paperId: string,
  options: InteractionRecordOptions = {},
) {
  const playlistId = await ensureReadLaterPlaylist(ownerId);

  const [created] = await db
    .insert(playlistItems)
    .values({
      playlistId,
      paperId,
      position: 0,
    })
    .onConflictDoNothing({
      target: [playlistItems.playlistId, playlistItems.paperId],
    })
    .returning({ paperId: playlistItems.paperId });

  if (created) {
    await recordPaperInteraction(
      ownerId,
      paperId,
      "save_to_playlist",
      "feed",
      options,
    );
    return;
  }

  await db
    .delete(playlistItems)
    .where(
      and(
        eq(playlistItems.playlistId, playlistId),
        eq(playlistItems.paperId, paperId),
      ),
    );
}

/** @user-scoped */
export async function getPaperPlaylistOptions(
  ownerId: string,
  paperId: string,
): Promise<PaperPlaylistOption[]> {
  const rows = await db
    .select({
      id: playlists.id,
      name: playlists.name,
      isDefault: playlists.isDefault,
      selectedPaperId: playlistItems.paperId,
    })
    .from(playlists)
    .leftJoin(
      playlistItems,
      and(
        eq(playlistItems.playlistId, playlists.id),
        eq(playlistItems.paperId, paperId),
      ),
    )
    .where(eq(playlists.ownerId, ownerId))
    .orderBy(desc(playlists.isDefault), playlists.createdAt);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    selected: row.selectedPaperId !== null,
  }));
}

/** @user-scoped */
export async function setPaperPlaylistMembership(
  ownerId: string,
  paperId: string,
  playlistId: string,
  selected: boolean,
  context: PlaylistSaveContext,
  options: InteractionRecordOptions = {},
) {
  return db.transaction(async (tx) => {
    const ownedPlaylist = await tx
      .select({ id: playlists.id })
      .from(playlists)
      .where(
        and(eq(playlists.id, playlistId), eq(playlists.ownerId, ownerId)),
      )
      .limit(1)
      .for("update");

    if (!ownedPlaylist.length) {
      throw new Error("Playlist is unavailable");
    }

    if (!selected) {
      await tx
        .delete(playlistItems)
        .where(
          and(
            eq(playlistItems.playlistId, playlistId),
            eq(playlistItems.paperId, paperId),
          ),
        );
      return { created: false, selected: false };
    }

    const maxRows = await tx
      .select({ position: playlistItems.position })
      .from(playlistItems)
      .where(eq(playlistItems.playlistId, playlistId))
      .orderBy(desc(playlistItems.position))
      .limit(1);
    const [created] = await tx
      .insert(playlistItems)
      .values({
        playlistId,
        paperId,
        position: (maxRows[0]?.position ?? -1) + 1,
      })
      .onConflictDoNothing({
        target: [playlistItems.playlistId, playlistItems.paperId],
      })
      .returning({ paperId: playlistItems.paperId });

    if (created) {
      await tx
        .select({ ownerId: profiles.ownerId })
        .from(profiles)
        .where(eq(profiles.ownerId, ownerId))
        .limit(1)
        .for("update");
      const existingSave = await tx
        .select({ id: userPaperInteractions.id })
        .from(userPaperInteractions)
        .where(
          and(
            eq(userPaperInteractions.ownerId, ownerId),
            eq(userPaperInteractions.paperId, paperId),
            eq(userPaperInteractions.action, "save_to_playlist"),
          ),
        )
        .limit(1);
      if (!existingSave.length) {
        await tx.insert(userPaperInteractions).values({
          ownerId,
          paperId,
          recommendationImpressionId:
            options.recommendationImpressionId ?? null,
          action: "save_to_playlist",
          context,
        });
      }
    }

    return { created: Boolean(created), selected: true };
  });
}

/** @user-scoped */
export async function createPlaylistWithPaper(
  ownerId: string,
  paperId: string,
  name: string,
  context: PlaylistSaveContext,
  options: InteractionRecordOptions = {},
) {
  return db.transaction(async (tx) => {
    await tx
      .select({ ownerId: profiles.ownerId })
      .from(profiles)
      .where(eq(profiles.ownerId, ownerId))
      .limit(1)
      .for("update");
    const [playlist] = await tx
      .insert(playlists)
      .values({ ownerId, name, isDefault: false })
      .returning({ id: playlists.id, name: playlists.name });

    await tx.insert(playlistItems).values({
      playlistId: playlist.id,
      paperId,
      position: 0,
    });
    const existingSave = await tx
      .select({ id: userPaperInteractions.id })
      .from(userPaperInteractions)
      .where(
        and(
          eq(userPaperInteractions.ownerId, ownerId),
          eq(userPaperInteractions.paperId, paperId),
          eq(userPaperInteractions.action, "save_to_playlist"),
        ),
      )
      .limit(1);
    if (!existingSave.length) {
      await tx.insert(userPaperInteractions).values({
        ownerId,
        paperId,
        recommendationImpressionId: options.recommendationImpressionId ?? null,
        action: "save_to_playlist",
        context,
      });
    }

    return {
      id: playlist.id,
      name: playlist.name,
      isDefault: false,
      selected: true,
    } satisfies PaperPlaylistOption;
  });
}

/** @user-scoped */
export async function createPlaylist(ownerId: string, name: string) {
  const [row] = await db
    .insert(playlists)
    .values({ ownerId, name, isDefault: false })
    .returning({ id: playlists.id, name: playlists.name });

  return row;
}

/** @user-scoped */
export async function renamePlaylist(
  ownerId: string,
  playlistId: string,
  name: string,
) {
  await db
    .update(playlists)
    .set({ name, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(playlists.id, playlistId),
        eq(playlists.ownerId, ownerId),
        ne(playlists.isDefault, true),
      ),
    );
}

/** @user-scoped */
export async function deletePlaylist(ownerId: string, playlistId: string) {
  await db
    .delete(playlists)
    .where(
      and(
        eq(playlists.id, playlistId),
        eq(playlists.ownerId, ownerId),
        ne(playlists.isDefault, true),
      ),
    );
}

/** @user-scoped */
export async function addToPlaylist(
  ownerId: string,
  playlistId: string,
  paperId: string,
) {
  await addToOwnedPlaylist(ownerId, playlistId, paperId);
}

/** @user-scoped */
export async function removeFromPlaylist(
  ownerId: string,
  playlistId: string,
  paperId: string,
) {
  await removeFromOwnedPlaylist(ownerId, playlistId, paperId);
}

/** @user-scoped */
export async function reorderPlaylistItems(
  ownerId: string,
  playlistId: string,
  orderedPaperIds: string[],
) {
  await reorderOwnedPlaylistItems(ownerId, playlistId, orderedPaperIds);
}
