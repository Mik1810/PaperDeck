import "server-only";

import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { and, asc, desc, eq, gt, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  profiles,
  playlists,
  playlistItems,
  papers,
  paperNotes,
  recommendationBatchItems,
  recommendationImpressions,
  recommendations,
  userInterests,
  favorites,
  userPaperFeedExclusions,
  userPaperInteractions,
} from "@/db/schema";
import {
  buildCandidateTopicWeights,
  buildSeenPaperIds,
  isRecommendationCandidateSource,
  isRankingFeedbackAction,
  rankFeedCandidates,
  type RankedPaper,
  type RankingInteraction,
  type RankingPaperCandidate,
} from "@/lib/ranking/feed-ranking";
import {
  getCatalogRankingCandidates,
  getPapersByIds,
  getRankingCandidatesByIds,
  getTopics,
  type CatalogRankingCandidate,
} from "@/lib/repositories/catalog";
import { topicDisplayLabel } from "@/lib/arxiv-categories";
import {
  type DigestRecencyCandidate,
  selectDigestPaperIdsByRecency,
} from "@/lib/digest-selection";
import { isDefaultOnboardingTopic } from "@/lib/topic-taxonomy";
import {
  INITIAL_FEED_RECOMMENDATION_COUNT,
  INITIAL_FEED_RECOMMENDATION_MAX_AGE_MS,
  INITIAL_FEED_RECOMMENDATION_MODEL_VERSION,
  LIVE_FEED_RECOMMENDATION_MODEL_VERSION,
  isUsableRecommendationBatchSize,
  needsCatalogRecommendationFill,
  recommendationModelVersionForFeedSource,
  type RecommendationFeedSource,
} from "@/lib/recommendation-batches";
import { reorderOwnedPlaylistItems } from "@/lib/repositories/playlist-items";
import { logger } from "@/lib/logging/logger";
import type {
  LibraryCollectionItem,
  LibraryCollectionKey,
  LibraryCollectionPage,
  LibraryPlaylistSummary,
} from "@/lib/library-collections";
import {
  decodeLibraryCursor,
  encodeLibraryCursor,
} from "@/lib/repositories/library-cursor";
import { refreshUserProfileEmbedding } from "@/lib/repositories/user-profile-embeddings";
import {
  getSemanticPaperCandidates,
  type SemanticRetrievalDiagnostics,
  type SemanticRetrievalFallbackReason,
} from "@/lib/repositories/semantic-retrieval";
import type { AuthenticatedUserContext } from "@/lib/auth/session";
import type { FeedPaper, InteractionType, Paper } from "@/types/paper";

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

type RecommendationDeliveryBatch = {
  batchId: string | null;
  batchItemIdsByPaperId: Map<string, string>;
};

type RecommendationBatchSource = "initial_batch" | "live_batch";

type FeedPresentationState = Pick<
  UserPaperState,
  "favoriteIds" | "readLaterIds"
>;

type RankedFeedData = {
  rankedPapers: RankedPaper[];
  presentationState: FeedPresentationState | null;
  timings: Record<string, number>;
  source: RecommendationFeedSource;
  liveBatchToCache: RankedPaper[];
};

const ignoredInteractionActions = ["dismiss", "not_interested"] as const;

function scheduleProfileEmbeddingRefresh(ownerId: string) {
  after(async () => {
    try {
      await refreshUserProfileEmbedding(ownerId);
    } catch (error) {
      logger.error("user_profile_embedding_refresh_failed", { ownerId, error });
    }
  });
}

type IgnoredInteractionAction = (typeof ignoredInteractionActions)[number];

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PaperPlaylistOption = {
  id: string;
  name: string;
  isDefault: boolean;
  selected: boolean;
};

export type PlaylistSaveContext = "feed" | "digest" | "paper_detail" | "group";
export type PlaylistMutationContext = PlaylistSaveContext | "library";

export type PlaylistMembershipTarget =
  | { kind: "playlist"; playlistId: string }
  | { kind: "read_later" }
  | { kind: "new_playlist"; name: string };

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

async function recordRecommendationBatchItems(
  ownerId: string,
  papers: RankedPaper[],
  modelVersion: string,
): Promise<RecommendationDeliveryBatch> {
  if (!papers.length) {
    return {
      batchId: null,
      batchItemIdsByPaperId: new Map(),
    };
  }

  const batchId = randomUUID();
  const deliveredAt = new Date().toISOString();
  const rows = await db
    .insert(recommendationBatchItems)
    .values(
      papers.map((paper, index) => ({
        ownerId,
        paperId: paper.id,
        batchId,
        rank: index + 1,
        score: paper.rankingScore,
        scoreComponents: paper.rankingScoreComponents,
        modelVersion,
        deliveredAt,
      })),
    )
    .returning({
      id: recommendationBatchItems.id,
      paperId: recommendationBatchItems.paperId,
    });

  return {
    batchId,
    batchItemIdsByPaperId: new Map(
      rows.map((row) => [row.paperId, row.id]),
    ),
  };
}

/** @user-scoped Records one actual visible-card impression idempotently. */
export async function recordRecommendationImpression(
  ownerId: string,
  paperId: string,
  recommendationBatchItemId: string | null | undefined,
) {
  if (
    !recommendationBatchItemId ||
    !isUuid(recommendationBatchItemId) ||
    !isUuid(paperId)
  ) {
    return null;
  }

  const batchItems = await db
    .select({
      id: recommendationBatchItems.id,
      batchId: recommendationBatchItems.batchId,
      rank: recommendationBatchItems.rank,
      score: recommendationBatchItems.score,
      scoreComponents: recommendationBatchItems.scoreComponents,
      modelVersion: recommendationBatchItems.modelVersion,
    })
    .from(recommendationBatchItems)
    .where(
      and(
        eq(recommendationBatchItems.id, recommendationBatchItemId),
        eq(recommendationBatchItems.ownerId, ownerId),
        eq(recommendationBatchItems.paperId, paperId),
      ),
    )
    .limit(1);
  const batchItem = batchItems[0];

  if (!batchItem) return null;

  const inserted = await db
    .insert(recommendationImpressions)
    .values({
      ownerId,
      paperId,
      batchItemId: batchItem.id,
      batchId: batchItem.batchId,
      rank: batchItem.rank,
      score: batchItem.score,
      scoreComponents: batchItem.scoreComponents,
      modelVersion: batchItem.modelVersion,
    })
    .onConflictDoNothing({ target: recommendationImpressions.batchItemId })
    .returning({ id: recommendationImpressions.id });

  if (inserted[0]?.id) return inserted[0].id;

  const existing = await db
    .select({ id: recommendationImpressions.id })
    .from(recommendationImpressions)
    .where(
      and(
        eq(recommendationImpressions.batchItemId, batchItem.id),
        eq(recommendationImpressions.ownerId, ownerId),
        eq(recommendationImpressions.paperId, paperId),
      ),
    )
    .limit(1);

  return existing[0]?.id ?? null;
}

export async function resolveRecommendationImpressionId(
  ownerId: string,
  paperId: string,
  recommendationImpressionId: string | null | undefined,
  recommendationBatchItemId?: string | null,
) {
  if (recommendationImpressionId && isUuid(recommendationImpressionId)) {
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

    if (rows[0]?.id) return rows[0].id;
  }

  return recordRecommendationImpression(
    ownerId,
    paperId,
    recommendationBatchItemId,
  );
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

function mergeCatalogRankingCandidates(
  ...candidateGroups: CatalogRankingCandidate[][]
) {
  const candidatesById = new Map<string, CatalogRankingCandidate>();

  for (const candidate of candidateGroups.flat()) {
    candidatesById.set(candidate.id, candidate);
  }

  return [...candidatesById.values()];
}

function toRankingCandidates(
  candidates: CatalogRankingCandidate[],
  topics: TopicRow[],
): RankingPaperCandidate[] {
  const topicsById = new Map(topics.map((topic) => [topic.id, topic]));

  return candidates.map((candidate) => ({
    id: candidate.id,
    year: candidate.year ?? undefined,
    citationCount: candidate.citationCount ?? undefined,
    isClassic: candidate.isClassic,
    topics: candidate.topicIds.flatMap((topicId) => {
      const topic = topicsById.get(topicId);
      if (!topic) return [];

      return [{
        id: topic.id,
        label: topicDisplayLabel({
          arxivCategory: topic.arxivCategory,
          label: topic.label,
        }),
        parentId: topic.parentId ?? undefined,
        arxivCategory: topic.arxivCategory ?? undefined,
      }];
    }),
  }));
}

function hydrateRankedCandidates(
  papersToHydrate: Paper[],
  rankedCandidates: ReturnType<typeof rankFeedCandidates>,
): RankedPaper[] {
  const rankingByPaperId = new Map(
    rankedCandidates.map((candidate) => [candidate.id, candidate]),
  );

  return papersToHydrate.flatMap((paper) => {
    const ranking = rankingByPaperId.get(paper.id);
    if (!ranking) return [];

    return [{
      ...paper,
      recommendationReason: ranking.recommendationReason,
      rankingScore: ranking.rankingScore,
      rankingScoreComponents: ranking.rankingScoreComponents,
    }];
  });
}

async function getFeedState(ownerId: string): Promise<FeedState> {
  const [
    interests,
    favRows,
    playlistRows,
    durableExclusionRows,
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
    db
      .selectDistinct({
        isDefault: playlists.isDefault,
        paperId: playlistItems.paperId,
      })
      .from(playlistItems)
      .innerJoin(
        playlists,
        and(
          eq(playlists.id, playlistItems.playlistId),
          eq(playlists.ownerId, ownerId),
        ),
      ),
    db
      .select({ paperId: userPaperFeedExclusions.paperId })
      .from(userPaperFeedExclusions)
      .where(eq(userPaperFeedExclusions.ownerId, ownerId)),
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
  const playlistPaperIds = new Set(playlistRows.map((r) => r.paperId));
  const readLaterIds = new Set(
    playlistRows.filter((row) => row.isDefault).map((row) => row.paperId),
  );

  return {
    selectedTopicIds: new Set(interests.map((r) => r.topicId)),
    userState: {
      favoriteIds,
      readLaterIds,
      seenIds: buildSeenPaperIds(
        favoriteIds,
        playlistPaperIds,
        durableExclusionRows.map((row) => row.paperId),
      ),
      interactions: interactionRows,
    },
  };
}

async function getFeedPresentationState(
  ownerId: string,
): Promise<FeedPresentationState> {
  const [favRows, readLaterRows] = await Promise.all([
    db
      .select({ paperId: favorites.paperId })
      .from(favorites)
      .where(eq(favorites.ownerId, ownerId)),
    db
      .select({ paperId: playlistItems.paperId })
      .from(playlistItems)
      .innerJoin(
        playlists,
        and(
          eq(playlists.id, playlistItems.playlistId),
          eq(playlists.ownerId, ownerId),
          eq(playlists.isDefault, true),
        ),
      ),
  ]);

  return {
    favoriteIds: new Set(favRows.map((row) => row.paperId)),
    readLaterIds: new Set(readLaterRows.map((row) => row.paperId)),
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
  const interactionPaperIds = state.interactions
    .filter((interaction) => isRankingFeedbackAction(interaction.action))
    .map((interaction) => interaction.paperId);
  const initialCandidateRows = await measureAsync(
    timings,
    "candidate_loading",
    getRankingCandidatesByIds([
      ...semanticCandidates.paperIds,
      ...interactionPaperIds,
    ]),
  );
  const hasSemanticCandidates = initialCandidateRows.some((candidate) =>
    semanticCandidates.semanticScores.has(candidate.id),
  );
  const initialRankingCandidates = toRankingCandidates(
    initialCandidateRows,
    topics,
  );
  const topicWeights = buildCandidateTopicWeights(
    initialRankingCandidates,
    topics,
    selectedTopicIds,
    state.interactions,
  );
  let catalogCandidates: CatalogRankingCandidate[] = [];

  if (!hasSemanticCandidates) {
    catalogCandidates = await measureAsync(
      timings,
      "catalog_candidate_loading",
      getCatalogRankingCandidates({
        excludedPaperIds: [...state.seenIds],
        topicWeights,
      }),
    );
  }

  let rankingCandidates = toRankingCandidates(
    mergeCatalogRankingCandidates(initialCandidateRows, catalogCandidates),
    topics,
  );
  let rankedCandidates = measureSync(timings, "ranking", () =>
    rankFeedCandidates(
      rankingCandidates,
      topics,
      selectedTopicIds,
      state,
      semanticCandidates.semanticScores,
    ),
  );

  let semanticFallbackReason: LiveRankedFeedResult["semanticFallbackReason"] =
    semanticCandidates.diagnostics.fallbackReason;

  if (semanticCandidates.paperIds.length && !hasSemanticCandidates) {
    semanticFallbackReason = "no_papers_loaded";
  }

  if (
    hasSemanticCandidates &&
    needsCatalogRecommendationFill(rankedCandidates.length)
  ) {
    semanticFallbackReason = rankedCandidates.length
      ? "insufficient_unseen_candidates"
      : "ranker_filtered_all";
    catalogCandidates = await measureAsync(
      timings,
      "catalog_candidate_loading",
      getCatalogRankingCandidates({
        excludedPaperIds: [...state.seenIds],
        topicWeights,
      }),
    );
    rankingCandidates = toRankingCandidates(
      mergeCatalogRankingCandidates(initialCandidateRows, catalogCandidates),
      topics,
    );
    rankedCandidates = measureSync(timings, "fallback_ranking", () =>
      rankFeedCandidates(
        rankingCandidates,
        topics,
        selectedTopicIds,
        state,
        semanticCandidates.semanticScores,
      ),
    );
  }

  const finalistCandidates = rankedCandidates.slice(
    0,
    INITIAL_FEED_RECOMMENDATION_COUNT,
  );
  const finalistPapers = await measureAsync(
    timings,
    "paper_hydration",
    getPapersByIds(finalistCandidates.map((candidate) => candidate.id)),
  );
  const rankedPapers = hydrateRankedCandidates(
    finalistPapers,
    finalistCandidates,
  );

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
  limit = INITIAL_FEED_RECOMMENDATION_COUNT,
) {
  return getLatestRecommendationBatch({
    limit,
    modelVersion: INITIAL_FEED_RECOMMENDATION_MODEL_VERSION,
    ownerId,
  });
}

async function getLatestLiveRecommendationBatch(
  ownerId: string,
  limit = INITIAL_FEED_RECOMMENDATION_COUNT,
) {
  return getLatestRecommendationBatch({
    limit,
    modelVersion: LIVE_FEED_RECOMMENDATION_MODEL_VERSION,
    ownerId,
  });
}

type CachedRecommendationRow = {
  candidateSource: string | null;
  paperId: string;
  reason: string | null;
  score: number;
};

async function getLatestRecommendationBatch({
  ownerId,
  modelVersion,
  limit = INITIAL_FEED_RECOMMENDATION_COUNT,
}: {
  ownerId: string;
  modelVersion: string;
  limit?: number;
}): Promise<CachedRecommendationRow[]> {
  const freshAfter = new Date(
    Date.now() - INITIAL_FEED_RECOMMENDATION_MAX_AGE_MS,
  ).toISOString();

  return db
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
        gte(recommendations.generatedAt, freshAfter),
        sql`${recommendations.generatedAt} = (
          select max(latest.generated_at)
          from ${recommendations} as latest
          where latest.owner_id = ${ownerId}
            and latest.model_version = ${modelVersion}
        )`,
        sql`not exists (
          select 1
          from ${favorites} as cached_favorite
          where cached_favorite.owner_id = ${ownerId}
            and cached_favorite.paper_id = ${recommendations.paperId}
        )`,
        sql`not exists (
          select 1
          from ${playlistItems} as cached_item
          inner join ${playlists} as cached_playlist
            on cached_playlist.id = cached_item.playlist_id
          where cached_playlist.owner_id = ${ownerId}
            and cached_item.paper_id = ${recommendations.paperId}
        )`,
        sql`not exists (
          select 1
          from ${userPaperFeedExclusions} as cached_exclusion
          where cached_exclusion.owner_id = ${ownerId}
            and cached_exclusion.paper_id = ${recommendations.paperId}
        )`,
      ),
    )
    .orderBy(desc(recommendations.score))
    .limit(limit);
}

async function hydrateRecommendationBatch(
  rows: CachedRecommendationRow[],
  source: RecommendationBatchSource,
) {
  const papers = await getPapersByIds(rows.map((row) => row.paperId));
  const papersById = new Map(papers.map((paper) => [paper.id, paper]));

  return rows
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
  const initialRows = await measureAsync(
    timings,
    "initial_batch_lookup",
    getLatestInitialRecommendationBatch(ownerId),
  );

  if (isUsableRecommendationBatchSize(initialRows.length)) {
    const rankedPapers = await measureAsync(
      timings,
      "initial_batch_hydration",
      hydrateRecommendationBatch(initialRows, "initial_batch"),
    );
    if (isUsableRecommendationBatchSize(rankedPapers.length)) {
      return {
        liveBatchToCache: [],
        presentationState: null,
        rankedPapers,
        source: "initial_batch",
        timings,
      };
    }
  }

  const liveRows = await measureAsync(
    timings,
    "live_batch_lookup",
    getLatestLiveRecommendationBatch(ownerId),
  );

  if (isUsableRecommendationBatchSize(liveRows.length)) {
    const rankedPapers = await measureAsync(
      timings,
      "live_batch_hydration",
      hydrateRecommendationBatch(liveRows, "live_batch"),
    );
    if (isUsableRecommendationBatchSize(rankedPapers.length)) {
      return {
        liveBatchToCache: [],
        presentationState: null,
        rankedPapers,
        source: "live_batch",
        timings,
      };
    }
  }

  const [topics, feedState] = await Promise.all([
    measureAsync(timings, "topics", getTopics()),
    measureAsync(timings, "feed_state", getFeedState(ownerId)),
  ]);
  const liveFeed = await buildLiveRankedFeed(ownerId, topics, feedState, timings);

  return {
    liveBatchToCache: liveFeed.rankedPapers.slice(
      0,
      INITIAL_FEED_RECOMMENDATION_COUNT,
    ),
    presentationState: feedState.userState,
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
  const state =
    feedData.presentationState ??
    (await measureAsync(
      timings,
      "presentation_state",
      getFeedPresentationState(ownerId),
    ));
  const deliveryBatch = await measureAsync(
    timings,
    "recommendation_batch_items",
    recordRecommendationBatchItems(
      ownerId,
      visiblePapers,
      recommendationModelVersionForFeedSource(feedData.source),
    ),
  );
  const feedPapers: FeedPaper[] = visiblePapers.map((paper) => ({
    ...paper,
    recommendationBatchItemId:
      deliveryBatch.batchItemIdsByPaperId.get(paper.id),
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
    recommendationDeliveryBatchId: deliveryBatch.batchId,
    recommendationBatchItemCount: deliveryBatch.batchItemIdsByPaperId.size,
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

export type DigestGroup = {
  topicLabel: string;
  papers: Paper[];
};

async function getDigestRecencyCandidates(
  paperIds: string[],
  maximumWindowDays: number,
  nowMs: number,
): Promise<DigestRecencyCandidate[]> {
  if (!paperIds.length) {
    return [];
  }

  const since = new Date(
    nowMs - maximumWindowDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  return db
    .select({
      availableAt: sql<string>`coalesce(${papers.publishedAt}, ${papers.ingestedAt})`,
      paperId: papers.id,
    })
    .from(papers)
    .where(
      and(
        inArray(papers.id, paperIds),
        sql`coalesce(${papers.publishedAt}, ${papers.ingestedAt}) >= ${since}`,
      ),
    );
}

/** @admin */
export async function getDigestPageData(ownerId: string) {
  const feedData = await getRankedFeedData(ownerId);
  const { rankedPapers } = feedData;
  const state =
    feedData.presentationState ?? (await getFeedPresentationState(ownerId));
  const rankedById = new Map(rankedPapers.map((paper) => [paper.id, paper]));

  const recentSelection = await selectDigestPaperIdsByRecency({
    loadCandidates: getDigestRecencyCandidates,
    minimumPaperCount: DIGEST_MIN_PAPER_COUNT,
    rankedPaperIds: rankedPapers.map((paper) => paper.id),
  });
  const recentIds = new Set(recentSelection.paperIds);
  const recentPapers = rankedPapers.filter((paper) => recentIds.has(paper.id));

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

export const LIBRARY_COLLECTION_PAGE_SIZE = 24;

type PlaylistPageRow = {
  addedAt: string;
  paperId: string;
  position: number;
};

type DatedPageRow = {
  paperId: string;
  timestamp: string;
};

type IgnoredPageRow = DatedPageRow & {
  action: IgnoredInteractionAction;
};

async function getLibraryMetadata(ownerId: string) {
  const [playlistRows, favoriteCountRows, ignoredCountRows] = await Promise.all([
    db
      .select({
        count: sql<number>`(
          select count(*)::integer
          from ${playlistItems} as counted_item
          where counted_item.playlist_id = ${playlists.id}
        )`,
        id: playlists.id,
        isDefault: playlists.isDefault,
        name: playlists.name,
      })
      .from(playlists)
      .where(eq(playlists.ownerId, ownerId))
      .orderBy(playlists.createdAt),
    db
      .select({ count: sql<number>`count(*)::integer` })
      .from(favorites)
      .where(eq(favorites.ownerId, ownerId)),
    db
      .select({ count: sql<number>`count(distinct ${userPaperInteractions.paperId})::integer` })
      .from(userPaperInteractions)
      .where(
        and(
          eq(userPaperInteractions.ownerId, ownerId),
          inArray(userPaperInteractions.action, ignoredInteractionActions),
        ),
      ),
  ]);

  const libraryPlaylists: LibraryPlaylistSummary[] = playlistRows.map(
    (playlist) => ({
      count: Number(playlist.count),
      id: playlist.id,
      isDefault: playlist.isDefault,
      name: playlist.name,
    }),
  );

  return {
    favoriteCount: Number(favoriteCountRows[0]?.count ?? 0),
    ignoredCount: Number(ignoredCountRows[0]?.count ?? 0),
    playlists: libraryPlaylists,
    readLaterCount:
      libraryPlaylists.find((playlist) => playlist.isDefault)?.count ?? 0,
  };
}

async function getPlaylistCollectionRows(
  ownerId: string,
  collectionKey: "read-later" | `playlist:${string}`,
  encodedCursor?: string | null,
): Promise<PlaylistPageRow[]> {
  const decodedCursor = decodeLibraryCursor(encodedCursor, "playlist");
  const cursor =
    decodedCursor?.sort === "playlist" ? decodedCursor : undefined;
  const isReadLater = collectionKey === "read-later";
  const playlistId = isReadLater
    ? null
    : collectionKey.slice("playlist:".length);
  const cursorCondition = cursor
    ? or(
        gt(playlistItems.position, cursor.position),
        and(
          eq(playlistItems.position, cursor.position),
          lt(playlistItems.addedAt, cursor.timestamp),
        ),
        and(
          eq(playlistItems.position, cursor.position),
          eq(playlistItems.addedAt, cursor.timestamp),
          gt(playlistItems.paperId, cursor.paperId),
        ),
      )
    : undefined;

  return db
    .select({
      addedAt: playlistItems.addedAt,
      paperId: playlistItems.paperId,
      position: playlistItems.position,
    })
    .from(playlistItems)
    .innerJoin(playlists, eq(playlists.id, playlistItems.playlistId))
    .where(
      and(
        eq(playlists.ownerId, ownerId),
        isReadLater
          ? eq(playlists.isDefault, true)
          : and(eq(playlists.id, playlistId!), eq(playlists.isDefault, false)),
        cursorCondition,
      ),
    )
    .orderBy(
      asc(playlistItems.position),
      desc(playlistItems.addedAt),
      asc(playlistItems.paperId),
    )
    .limit(LIBRARY_COLLECTION_PAGE_SIZE + 1);
}

async function getFavoriteCollectionRows(
  ownerId: string,
  encodedCursor?: string | null,
): Promise<DatedPageRow[]> {
  const decodedCursor = decodeLibraryCursor(encodedCursor, "favorites");
  const cursor =
    decodedCursor?.sort === "favorites" ? decodedCursor : undefined;
  const cursorCondition = cursor
    ? or(
        lt(favorites.createdAt, cursor.timestamp),
        and(
          eq(favorites.createdAt, cursor.timestamp),
          gt(favorites.paperId, cursor.paperId),
        ),
      )
    : undefined;

  const rows = await db
    .select({
      paperId: favorites.paperId,
      timestamp: favorites.createdAt,
    })
    .from(favorites)
    .where(and(eq(favorites.ownerId, ownerId), cursorCondition))
    .orderBy(desc(favorites.createdAt), asc(favorites.paperId))
    .limit(LIBRARY_COLLECTION_PAGE_SIZE + 1);

  return rows;
}

async function getIgnoredCollectionRows(
  ownerId: string,
  encodedCursor?: string | null,
): Promise<IgnoredPageRow[]> {
  const decodedCursor = decodeLibraryCursor(encodedCursor, "ignored");
  const cursor = decodedCursor?.sort === "ignored" ? decodedCursor : undefined;
  const cursorBoundary = cursor
    ? sql`(
        latest.ignored_at < ${cursor.timestamp}::timestamptz
        or (
          latest.ignored_at = ${cursor.timestamp}::timestamptz
          and latest.paper_id > ${cursor.paperId}::uuid
        )
      )`
    : sql`true`;

  const result = await db.execute<{
    action: IgnoredInteractionAction;
    ignored_at: string;
    paper_id: string;
  }>(sql`
    with latest as (
      select distinct on (interaction.paper_id)
        interaction.paper_id,
        interaction.action,
        interaction.created_at as ignored_at
      from ${userPaperInteractions} as interaction
      where interaction.owner_id = ${ownerId}
        and interaction.action in ('dismiss', 'not_interested')
      order by interaction.paper_id, interaction.created_at desc, interaction.id desc
    )
    select
      latest.paper_id,
      latest.action,
      latest.ignored_at::text as ignored_at
    from latest
    where ${cursorBoundary}
    order by latest.ignored_at desc, latest.paper_id
    limit ${LIBRARY_COLLECTION_PAGE_SIZE + 1}
  `);

  return result.rows.map((row) => ({
    action: row.action,
    paperId: row.paper_id,
    timestamp: row.ignored_at,
  }));
}

async function collectionItemsFromRows(
  rows: Array<DatedPageRow | IgnoredPageRow>,
): Promise<LibraryCollectionItem[]> {
  const papersForRows = await getPapersByIds(rows.map((row) => row.paperId));
  const paperById = new Map(papersForRows.map((paper) => [paper.id, paper]));

  return rows.flatMap((row) => {
    const paper = paperById.get(row.paperId);
    if (!paper) return [];
    return [
      "action" in row
        ? {
            ignoredAction: row.action,
            ignoredAt: row.timestamp,
            paper,
          }
        : { paper },
    ];
  });
}

/** @user-scoped */
export async function getLibraryCollectionPage(
  ownerId: string,
  collectionKey: LibraryCollectionKey,
  encodedCursor?: string | null,
): Promise<LibraryCollectionPage> {
  if (collectionKey === "read-later" || collectionKey.startsWith("playlist:")) {
    const playlistCollectionKey = collectionKey as
      | "read-later"
      | `playlist:${string}`;
    const rows = await getPlaylistCollectionRows(
      ownerId,
      playlistCollectionKey,
      encodedCursor,
    );
    const visibleRows = rows.slice(0, LIBRARY_COLLECTION_PAGE_SIZE);
    const lastRow = visibleRows.at(-1);

    return {
      collectionKey,
      items: await collectionItemsFromRows(
        visibleRows.map((row) => ({
          paperId: row.paperId,
          timestamp: row.addedAt,
        })),
      ),
      nextCursor:
        rows.length > LIBRARY_COLLECTION_PAGE_SIZE && lastRow
          ? encodeLibraryCursor({
              paperId: lastRow.paperId,
              position: lastRow.position,
              sort: "playlist",
              timestamp: lastRow.addedAt,
              version: 1,
            })
          : null,
    };
  }

  const datedCollectionKey =
    collectionKey === "favorites" ? "favorites" : "ignored";
  const rows =
    datedCollectionKey === "favorites"
      ? await getFavoriteCollectionRows(ownerId, encodedCursor)
      : await getIgnoredCollectionRows(ownerId, encodedCursor);
  const visibleRows = rows.slice(0, LIBRARY_COLLECTION_PAGE_SIZE);
  const lastRow = visibleRows.at(-1);

  return {
    collectionKey,
    items: await collectionItemsFromRows(visibleRows),
    nextCursor:
      rows.length > LIBRARY_COLLECTION_PAGE_SIZE && lastRow
        ? encodeLibraryCursor({
            paperId: lastRow.paperId,
            sort: datedCollectionKey,
            timestamp: lastRow.timestamp,
            version: 1,
          })
        : null,
  };
}

/** @user-scoped */
export async function getLibraryInitialData(
  ownerId: string,
  requestedCollectionKey: LibraryCollectionKey = "read-later",
) {
  const metadata = await getLibraryMetadata(ownerId);
  const selectedCollectionKey = requestedCollectionKey.startsWith("playlist:")
    ? metadata.playlists.some(
        (playlist) =>
          !playlist.isDefault &&
          playlist.id === requestedCollectionKey.slice("playlist:".length),
      )
      ? requestedCollectionKey
      : "read-later"
    : requestedCollectionKey;

  return {
    ...metadata,
    initialCollectionPage: await getLibraryCollectionPage(
      ownerId,
      selectedCollectionKey,
    ),
    selectedCollectionKey,
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
  scheduleProfileEmbeddingRefresh(ownerId);
}

/** @user-scoped */
export async function setFavoriteState(
  ownerId: string,
  paperId: string,
  selected: boolean,
  options: InteractionRecordOptions = {},
) {
  const result = await db.transaction(async (tx) => {
    if (!selected) {
      const removed = await tx
        .delete(favorites)
        .where(
          and(
            eq(favorites.ownerId, ownerId),
            eq(favorites.paperId, paperId),
          ),
        )
        .returning({ paperId: favorites.paperId });
      return { changed: removed.length > 0, selected: false };
    }

    const [created] = await tx
      .insert(favorites)
      .values({ ownerId, paperId })
      .onConflictDoNothing({ target: [favorites.ownerId, favorites.paperId] })
      .returning({ paperId: favorites.paperId });

    if (created) {
      await tx.insert(userPaperInteractions).values({
        ownerId,
        paperId,
        recommendationImpressionId: options.recommendationImpressionId ?? null,
        action: "favorite",
        context: "feed",
      });
    }

    return { changed: Boolean(created), selected: true };
  });

  if (result.changed) scheduleProfileEmbeddingRefresh(ownerId);
  return result;
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

/**
 * Canonical user-scoped service for every private-playlist membership change.
 * Playlist authorization, row serialization, max-position allocation,
 * interaction recording, and membership state commit in one transaction.
 */
export async function setPlaylistMembership(
  ownerId: string,
  paperId: string,
  target: PlaylistMembershipTarget,
  selected: boolean,
  context: PlaylistMutationContext,
  options: InteractionRecordOptions = {},
) {
  const result = await db.transaction(async (tx) => {
    if (target.kind === "new_playlist" && !selected) {
      throw new Error("A new playlist must start selected");
    }

    let ownedPlaylist:
      | { id: string; isDefault: boolean; name: string }
      | undefined;

    if (target.kind === "new_playlist") {
      [ownedPlaylist] = await tx
        .insert(playlists)
        .values({ ownerId, name: target.name, isDefault: false })
        .returning({
          id: playlists.id,
          isDefault: playlists.isDefault,
          name: playlists.name,
        });
    } else if (target.kind === "read_later" && selected) {
      [ownedPlaylist] = await tx
        .insert(playlists)
        .values({
          ownerId,
          name: "Read later",
          description: "Default private queue for papers to revisit.",
          isDefault: true,
        })
        .onConflictDoNothing({ target: [playlists.ownerId, playlists.name] })
        .returning({
          id: playlists.id,
          isDefault: playlists.isDefault,
          name: playlists.name,
        });
    }

    if (!ownedPlaylist) {
      if (target.kind === "new_playlist") {
        throw new Error("Created playlist is unavailable");
      }
      const rows = await tx
        .select({
          id: playlists.id,
          isDefault: playlists.isDefault,
          name: playlists.name,
        })
        .from(playlists)
        .where(
          target.kind === "read_later"
            ? and(
                eq(playlists.ownerId, ownerId),
                eq(playlists.name, "Read later"),
              )
            : and(
                eq(playlists.id, target.playlistId),
                eq(playlists.ownerId, ownerId),
              ),
        )
        .limit(1)
        .for("update");
      ownedPlaylist = rows[0];
    }

    if (!ownedPlaylist) {
      if (target.kind === "read_later" && !selected) {
        return {
          changed: false,
          created: false,
          option: null,
          selected: false,
        };
      }
      throw new Error("Playlist is unavailable");
    }

    const playlistId = ownedPlaylist.id;
    const option = {
      id: playlistId,
      isDefault: ownedPlaylist.isDefault,
      name: ownedPlaylist.name,
      selected,
    } satisfies PaperPlaylistOption;

    if (!selected) {
      const removed = await tx
        .delete(playlistItems)
        .where(
          and(
            eq(playlistItems.playlistId, playlistId),
            eq(playlistItems.paperId, paperId),
          ),
        )
        .returning({ paperId: playlistItems.paperId });
      return {
        changed: removed.length > 0,
        created: false,
        option,
        selected: false,
      };
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
      await tx.insert(userPaperInteractions).values({
        ownerId,
        paperId,
        recommendationImpressionId: options.recommendationImpressionId ?? null,
        action: "save_to_playlist",
        context,
      });
    }

    return {
      changed: Boolean(created),
      created: Boolean(created),
      option,
      selected: true,
    };
  });

  if (result.changed) scheduleProfileEmbeddingRefresh(ownerId);
  return result;
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
  const deleted = await db
    .delete(playlists)
    .where(
      and(
        eq(playlists.id, playlistId),
        eq(playlists.ownerId, ownerId),
        ne(playlists.isDefault, true),
      ),
    )
    .returning({ id: playlists.id });

  if (deleted.length) scheduleProfileEmbeddingRefresh(ownerId);
}

/** @user-scoped */
export async function reorderPlaylistItems(
  ownerId: string,
  playlistId: string,
  orderedPaperIds: string[],
) {
  await reorderOwnedPlaylistItems(ownerId, playlistId, orderedPaperIds);
}
