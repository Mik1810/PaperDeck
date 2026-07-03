import "server-only";

import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  profiles,
  playlists,
  playlistItems,
  userInterests,
  favorites,
  userPaperInteractions,
} from "@/db/schema";
import {
  isFeedHiddenAction,
  rankFeedPapers,
  type RankingInteraction,
} from "@/lib/ranking/feed-ranking";
import { getAllPapers, getPapersByIds, getTopics } from "@/lib/repositories/catalog";
import {
  addToOwnedPlaylist,
  removeFromOwnedPlaylist,
  reorderOwnedPlaylistItems,
} from "@/lib/repositories/playlist-items";
import { getSemanticPaperCandidates } from "@/lib/repositories/semantic-retrieval";
import type { AuthenticatedUserContext } from "@/lib/auth/session";
import type { InteractionType, Playlist } from "@/types/paper";

type TopicRow = Awaited<ReturnType<typeof getTopics>>[number];

type UserPaperState = {
  favoriteIds: Set<string>;
  readLaterIds: Set<string>;
  seenIds: Set<string>;
  interactions: RankingInteraction[];
};

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
        displayName: user.displayName,
        imageUrl: user.imageUrl,
        updatedAt: now,
      },
    });

  await ensureReadLaterPlaylist(user.ownerId);
}

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

export async function ensureReadLaterPlaylist(ownerId: string) {
  const existingId = await findReadLaterPlaylistId(ownerId);

  if (existingId) {
    return existingId;
  }

  const [created] = await db
    .insert(playlists)
    .values({
      ownerId,
      name: "Read later",
      description: "Default private queue for papers to revisit.",
      isDefault: true,
    })
    .returning({ id: playlists.id });

  if (!created) {
    throw new Error("Create Read later playlist: missing saved row");
  }

  return created.id;
}

export async function getSelectedTopicIds(ownerId: string) {
  const rows = await db
    .select({ topicId: userInterests.topicId })
    .from(userInterests)
    .where(eq(userInterests.ownerId, ownerId));

  return new Set(rows.map((r) => r.topicId));
}

export async function saveSelectedTopics(ownerId: string, topicIds: string[]) {
  await db
    .delete(userInterests)
    .where(eq(userInterests.ownerId, ownerId));

  if (topicIds.length) {
    await db.insert(userInterests).values(
      topicIds.map((topicId) => ({
        ownerId,
        topicId,
        weight: 1,
      })),
    );
  }

  const now = new Date().toISOString();

  await db
    .update(profiles)
    .set({
      onboardingCompletedAt: now,
      updatedAt: now,
    })
    .where(eq(profiles.ownerId, ownerId));
}

export async function getOnboardingData(ownerId: string) {
  const [topics, feedState] = await Promise.all([
    getTopics(),
    getFeedState(ownerId),
  ]);

  return {
    topics,
    selectedTopicIds: feedState.selectedTopicIds,
  };
}

type FeedState = {
  selectedTopicIds: Set<string>;
  userState: UserPaperState;
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

  return {
    selectedTopicIds: new Set(interests.map((r) => r.topicId)),
    userState: {
      favoriteIds: new Set(favRows.map((r) => r.paperId)),
      readLaterIds: new Set(rlPlaylist.map((r) => r.paperId)),
      seenIds: new Set(
        interactionRows
          .filter((r) => isFeedHiddenAction(r.action))
          .map((r) => r.paperId),
      ),
      interactions: interactionRows,
    },
  };
}

export async function getFeedPageData(ownerId: string) {
  const startedAt = performance.now();
  const timings: Record<string, number> = {};
  const [topics, feedState] = await Promise.all([
    measureAsync(timings, "topics", getTopics()),
    measureAsync(timings, "feed_state", getFeedState(ownerId)),
  ]);
  const selectedTopicIds = feedState.selectedTopicIds;
  const state = feedState.userState;

  const semanticCandidates = await measureAsync(
    timings,
    "semantic_retrieval",
    getSemanticPaperCandidates(ownerId),
  );
  const papers = semanticCandidates.papers.length
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

  let semanticFallbackReason = semanticCandidates.diagnostics.fallbackReason;

  if (!rankedPapers.length && semanticCandidates.papers.length) {
    semanticFallbackReason = "ranker_filtered_all";
    const fallbackPapers = await measureAsync(
      timings,
      "fallback_paper_loading",
      getAllPapers(),
    );
    rankedPapers = measureSync(timings, "fallback_ranking", () =>
      rankFeedPapers(fallbackPapers, topics, selectedTopicIds, state),
    );
  }

  console.info(
    JSON.stringify({
      event: "feed_timing",
      totalMs: Math.round(performance.now() - startedAt),
      timings,
      semantic: {
        used: Boolean(semanticCandidates.papers.length && rankedPapers.length),
        requestedCount: semanticCandidates.diagnostics.requestedCount,
        rpcAttempted: semanticCandidates.diagnostics.rpcAttempted,
        matchedCount: semanticCandidates.diagnostics.matchedCount,
        candidateCount: semanticCandidates.diagnostics.candidateCount,
        model: semanticCandidates.diagnostics.model,
        fallbackReason: semanticFallbackReason,
        profileRefreshStatus:
          semanticCandidates.diagnostics.profileRefreshStatus,
        profileRefreshReason:
          semanticCandidates.diagnostics.profileRefreshReason,
        profileRefreshError: semanticCandidates.diagnostics.profileRefreshError,
      },
      rankedCount: rankedPapers.length,
    }),
  );

  return {
    activePaper: rankedPapers[0] ?? null,
    nextPapers: rankedPapers.slice(1, 4),
    favoriteIds: state.favoriteIds,
    readLaterIds: state.readLaterIds,
    readLaterCount: state.readLaterIds.size,
  };
}

export async function getLibraryPageData(ownerId: string) {
  const playlistRows = await db
    .select({
      id: playlists.id,
      name: playlists.name,
      isDefault: playlists.isDefault,
    })
    .from(playlists)
    .where(eq(playlists.ownerId, ownerId))
    .orderBy(playlists.createdAt);

  const favoriteRows = await db
    .select({ paperId: favorites.paperId })
    .from(favorites)
    .where(eq(favorites.ownerId, ownerId));

  const readLaterPlaylist = playlistRows.find(
    (p) => p.name === "Read later",
  );

  let readLaterIds: string[] = [];

  if (readLaterPlaylist) {
    const items = await db
      .select({ paperId: playlistItems.paperId })
      .from(playlistItems)
      .where(eq(playlistItems.playlistId, readLaterPlaylist.id))
      .orderBy(desc(playlistItems.addedAt));
    readLaterIds = items.map((r) => r.paperId);
  }

  const favoriteIds = favoriteRows.map((r) => r.paperId);

  const [favoritePapers, readLaterPapers] = await Promise.all([
    getPapersByIds(favoriteIds),
    getPapersByIds(readLaterIds),
  ]);

  const playlistSummaries: Playlist[] = await Promise.all(
    playlistRows.map(async (playlist) => {
      const items = await db
        .select({ paperId: playlistItems.paperId })
        .from(playlistItems)
        .where(eq(playlistItems.playlistId, playlist.id));

      return {
        id: playlist.id,
        name: playlist.name,
        paperIds: items.map((r) => r.paperId),
        isDefault: playlist.isDefault ?? false,
      };
    }),
  );

  return {
    playlists: playlistSummaries,
    favoritePapers,
    readLaterPapers,
    readLaterCount: readLaterIds.length,
  };
}

export async function getSettingsPageData(ownerId: string) {
  const [topics, feedState] = await Promise.all([
    getTopics(),
    getFeedState(ownerId),
  ]);

  return {
    interests: topics.map((topic: TopicRow) => ({
      id: topic.id,
      label: topic.label,
      depth: topic.depth,
      selected: feedState.selectedTopicIds.has(topic.id),
    })),
    readLaterCount: feedState.userState.readLaterIds.size,
  };
}

export async function getPaperDetailData(ownerId: string, paperId: string) {
  const [papers, state] = await Promise.all([
    getPapersByIds([paperId], { includeSummary: true }),
    getPaperDetailState(ownerId, paperId),
  ]);

  return {
    paper: papers[0] ?? null,
    isFavorite: state.isFavorite,
    isSaved: state.isSaved,
    readLaterCount: state.readLaterCount,
  };
}

async function getPaperDetailState(ownerId: string, paperId: string) {
  const [favRow, rlPlaylist] = await Promise.all([
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
  ]);

  const playlistId = rlPlaylist[0]?.id;

  if (!playlistId) {
    return {
      isFavorite: favRow.length > 0,
      isSaved: false,
      readLaterCount: 0,
    };
  }

  const [readLaterItem, readLaterCount] = await Promise.all([
    db
      .select({ paperId: playlistItems.paperId })
      .from(playlistItems)
      .where(
        and(
          eq(playlistItems.playlistId, playlistId),
          eq(playlistItems.paperId, paperId),
        ),
      )
      .limit(1),
    db
      .select({ count: sql<number>`count(*)` })
      .from(playlistItems)
      .where(eq(playlistItems.playlistId, playlistId)),
  ]);

  return {
    isFavorite: favRow.length > 0,
    isSaved: readLaterItem.length > 0,
    readLaterCount: Number(readLaterCount[0]?.count ?? 0),
  };
}

export async function recordPaperInteraction(
  ownerId: string,
  paperId: string,
  action: InteractionType,
  context = "feed",
) {
  await db.insert(userPaperInteractions).values({
    ownerId,
    paperId,
    action,
    context,
  });
}

export async function toggleFavorite(ownerId: string, paperId: string) {
  const existing = await db
    .select({ paperId: favorites.paperId })
    .from(favorites)
    .where(
      and(
        eq(favorites.ownerId, ownerId),
        eq(favorites.paperId, paperId),
      ),
    )
    .limit(1);

  if (existing.length) {
    await db
      .delete(favorites)
      .where(
        and(
          eq(favorites.ownerId, ownerId),
          eq(favorites.paperId, paperId),
        ),
      );
    return;
  }

  await db.insert(favorites).values({ ownerId, paperId });
  await recordPaperInteraction(ownerId, paperId, "favorite");
}

export async function toggleReadLater(ownerId: string, paperId: string) {
  const playlistId = await ensureReadLaterPlaylist(ownerId);

  const existing = await db
    .select({ paperId: playlistItems.paperId })
    .from(playlistItems)
    .where(
      and(
        eq(playlistItems.playlistId, playlistId),
        eq(playlistItems.paperId, paperId),
      ),
    )
    .limit(1);

  if (existing.length) {
    await db
      .delete(playlistItems)
      .where(
        and(
          eq(playlistItems.playlistId, playlistId),
          eq(playlistItems.paperId, paperId),
        ),
      );
    return;
  }

  await db
    .insert(playlistItems)
    .values({
      playlistId,
      paperId,
      position: 0,
    })
    .onConflictDoUpdate({
      target: [playlistItems.playlistId, playlistItems.paperId],
      set: { position: 0 },
    });

  await recordPaperInteraction(ownerId, paperId, "save_to_playlist");
}

export async function createPlaylist(ownerId: string, name: string) {
  const [row] = await db
    .insert(playlists)
    .values({ ownerId, name, isDefault: false })
    .returning({ id: playlists.id, name: playlists.name });

  return row;
}

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

export async function addToPlaylist(
  ownerId: string,
  playlistId: string,
  paperId: string,
) {
  await addToOwnedPlaylist(ownerId, playlistId, paperId);
}

export async function removeFromPlaylist(
  ownerId: string,
  playlistId: string,
  paperId: string,
) {
  await removeFromOwnedPlaylist(ownerId, playlistId, paperId);
}

export async function reorderPlaylistItems(
  ownerId: string,
  playlistId: string,
  orderedPaperIds: string[],
) {
  await reorderOwnedPlaylistItems(ownerId, playlistId, orderedPaperIds);
}
