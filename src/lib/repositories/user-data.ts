import "server-only";

import {
  isFeedHiddenAction,
  rankFeedPapers,
  type RankingInteraction,
} from "@/lib/ranking/feed-ranking";
import { getAllPapers, getPapersByIds, getTopics } from "@/lib/repositories/catalog";
import { getSemanticPaperCandidates } from "@/lib/repositories/semantic-retrieval";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { AuthenticatedUserContext } from "@/lib/auth/session";
import type { InteractionType, Playlist } from "@/types/paper";

type TopicRow = Awaited<ReturnType<typeof getTopics>>[number];

type UserPaperState = {
  favoriteIds: Set<string>;
  readLaterIds: Set<string>;
  seenIds: Set<string>;
  interactions: RankingInteraction[];
};

type RepositoryError = {
  code?: string;
  details?: string | null;
  message: string;
};

function assertNoError(error: RepositoryError | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

function isMissingProfileError(error: RepositoryError | null) {
  if (!error || error.code !== "23503") {
    return false;
  }

  return `${error.message} ${error.details ?? ""}`.includes("profiles");
}

async function mutateWithProfileRetry(
  ownerId: string,
  context: string,
  mutate: () => PromiseLike<{ error: RepositoryError | null }>,
) {
  let { error } = await mutate();

  if (isMissingProfileError(error)) {
    await ensureUserProfileForOwner(ownerId);
    ({ error } = await mutate());
  }

  assertNoError(error, context);
}

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
  const supabase = createServiceRoleClient();
  const now = new Date().toISOString();

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      owner_id: user.ownerId,
      display_name: user.displayName,
      image_url: user.imageUrl,
      updated_at: now,
    },
    { onConflict: "owner_id" },
  );

  assertNoError(profileError, "Ensure profile");
  await ensureReadLaterPlaylist(user.ownerId);
}

export async function ensureUserProfileForOwner(ownerId: string) {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("profiles")
    .upsert(
      {
        owner_id: ownerId,
      },
      { ignoreDuplicates: true, onConflict: "owner_id" },
    );

  assertNoError(error, "Ensure profile");
}

async function findReadLaterPlaylistId(ownerId: string) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("playlists")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("name", "Read later")
    .maybeSingle();

  assertNoError(error, "Find Read later playlist");

  return data?.id as string | undefined;
}

export async function ensureReadLaterPlaylist(ownerId: string) {
  const supabase = createServiceRoleClient();
  const existingId = await findReadLaterPlaylistId(ownerId);

  if (existingId) {
    return existingId;
  }

  const createPlaylist = () =>
    supabase
      .from("playlists")
      .insert({
        owner_id: ownerId,
        name: "Read later",
        description: "Default private queue for papers to revisit.",
        is_default: true,
      })
      .select("id")
      .single();

  let { data: created, error: createError } = await createPlaylist();

  if (isMissingProfileError(createError)) {
    await ensureUserProfileForOwner(ownerId);
    ({ data: created, error: createError } = await createPlaylist());
  }

  assertNoError(createError, "Create Read later playlist");
  if (!created) {
    throw new Error("Create Read later playlist: missing saved row");
  }

  return created.id as string;
}

export async function getSelectedTopicIds(ownerId: string) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("user_interests")
    .select("topic_id")
    .eq("owner_id", ownerId);

  assertNoError(error, "Load selected topics");

  return new Set((data ?? []).map((item) => item.topic_id as string));
}

export async function saveSelectedTopics(ownerId: string, topicIds: string[]) {
  const supabase = createServiceRoleClient();

  const { error: deleteError } = await supabase
    .from("user_interests")
    .delete()
    .eq("owner_id", ownerId);

  assertNoError(deleteError, "Clear selected topics");

  if (topicIds.length) {
    const { error: insertError } = await supabase.from("user_interests").insert(
      topicIds.map((topicId) => ({
        owner_id: ownerId,
        topic_id: topicId,
        weight: 1,
      })),
    );

    assertNoError(insertError, "Save selected topics");
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      onboarding_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("owner_id", ownerId);

  assertNoError(profileError, "Mark onboarding complete");
}

export async function getOnboardingData(ownerId: string) {
  const topics = await getTopics();
  const selectedTopicIds = await getSelectedTopicIds(ownerId);

  return {
    topics,
    selectedTopicIds,
  };
}

async function getUserPaperState(ownerId: string): Promise<UserPaperState> {
  const supabase = createServiceRoleClient();

  const [
    { data: favorites, error: favoritesError },
    { data: readLaterPlaylist, error: readLaterPlaylistError },
    { data: interactions, error: interactionsError },
  ] = await Promise.all([
    supabase.from("favorites").select("paper_id").eq("owner_id", ownerId),
    supabase
      .from("playlists")
      .select("id, playlist_items(paper_id)")
      .eq("owner_id", ownerId)
      .eq("name", "Read later")
      .maybeSingle(),
    supabase
      .from("user_paper_interactions")
      .select("paper_id, action")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  assertNoError(favoritesError, "Load favorites");
  assertNoError(readLaterPlaylistError, "Load Read later playlist");
  assertNoError(interactionsError, "Load negative interactions");

  const playlistItems =
    (readLaterPlaylist?.playlist_items as Array<{ paper_id: string }> | undefined) ??
    [];

  return {
    favoriteIds: new Set((favorites ?? []).map((item) => item.paper_id as string)),
    readLaterIds: new Set(playlistItems.map((item) => item.paper_id)),
    seenIds: new Set(
      ((interactions ?? []) as RankingInteraction[])
        .filter((item) => isFeedHiddenAction(item.action))
        .map((item) => item.paper_id),
    ),
    interactions: (interactions ?? []) as RankingInteraction[],
  };
}

export async function getFeedPageData(ownerId: string) {
  const startedAt = performance.now();
  const timings: Record<string, number> = {};
  const [topics, selectedTopicIds, state] = await Promise.all([
    measureAsync(timings, "topics", getTopics()),
    measureAsync(timings, "selected_topics", getSelectedTopicIds(ownerId)),
    measureAsync(timings, "user_state", getUserPaperState(ownerId)),
  ]);

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
  const supabase = createServiceRoleClient();

  const [
    { data: playlists, error: playlistsError },
    { data: favoriteRows, error: favoritesError },
  ] = await Promise.all([
    supabase
      .from("playlists")
      .select("id, name, is_default, playlist_items(paper_id)")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: true }),
    supabase.from("favorites").select("paper_id").eq("owner_id", ownerId),
  ]);

  assertNoError(playlistsError, "Load playlists");
  assertNoError(favoritesError, "Load library favorites");

  const readLaterPlaylist = (playlists ?? []).find(
    (playlist) => playlist.name === "Read later",
  );
  const readLaterPlaylistId = readLaterPlaylist?.id as string | undefined;
  const { data: readLaterRows, error: readLaterError } = readLaterPlaylistId
    ? await supabase
        .from("playlist_items")
        .select("paper_id")
        .eq("playlist_id", readLaterPlaylistId)
        .order("added_at", { ascending: false })
    : { data: [], error: null };

  assertNoError(readLaterError, "Load library Read later");

  const favoriteIds = (favoriteRows ?? []).map((row) => row.paper_id as string);
  const readLaterIds = (readLaterRows ?? []).map((row) => row.paper_id as string);

  const [favoritePapers, readLaterPapers] = await Promise.all([
    getPapersByIds(favoriteIds),
    getPapersByIds(readLaterIds),
  ]);

  const playlistSummaries: Playlist[] = (playlists ?? []).map((playlist) => ({
    id: playlist.id as string,
    name: playlist.name as string,
    paperIds: ((playlist.playlist_items ?? []) as Array<{ paper_id: string }>).map(
      (item) => item.paper_id,
    ),
    isDefault: (playlist.is_default as boolean) ?? false,
  }));

  return {
    playlists: playlistSummaries,
    favoritePapers,
    readLaterPapers,
    readLaterCount: readLaterIds.length,
  };
}

export async function getSettingsPageData(ownerId: string) {
  const topics = await getTopics();
  const selectedTopicIds = await getSelectedTopicIds(ownerId);
  const state = await getUserPaperState(ownerId);

  return {
    interests: topics.map((topic: TopicRow) => ({
      id: topic.id,
      label: topic.label,
      depth: topic.depth,
      selected: selectedTopicIds.has(topic.id),
    })),
    readLaterCount: state.readLaterIds.size,
  };
}

export async function getPaperDetailData(ownerId: string, paperId: string) {
  const [papers, state] = await Promise.all([
    getPapersByIds([paperId]),
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
  const supabase = createServiceRoleClient();
  const [
    { data: favorite, error: favoriteError },
    { data: readLaterPlaylist, error: readLaterPlaylistError },
  ] = await Promise.all([
    supabase
      .from("favorites")
      .select("paper_id")
      .eq("owner_id", ownerId)
      .eq("paper_id", paperId)
      .maybeSingle(),
    supabase
      .from("playlists")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("name", "Read later")
      .maybeSingle(),
  ]);

  assertNoError(favoriteError, "Load detail favorite state");
  assertNoError(readLaterPlaylistError, "Load detail Read later playlist");

  const playlistId = readLaterPlaylist?.id as string | undefined;

  if (!playlistId) {
    return {
      isFavorite: Boolean(favorite),
      isSaved: false,
      readLaterCount: 0,
    };
  }

  const [
    { data: readLaterItem, error: readLaterItemError },
    { count: readLaterCount, error: readLaterCountError },
  ] = await Promise.all([
    supabase
      .from("playlist_items")
      .select("paper_id")
      .eq("playlist_id", playlistId)
      .eq("paper_id", paperId)
      .maybeSingle(),
    supabase
      .from("playlist_items")
      .select("paper_id", { count: "exact", head: true })
      .eq("playlist_id", playlistId),
  ]);

  assertNoError(readLaterItemError, "Load detail Read later state");
  assertNoError(readLaterCountError, "Count detail Read later items");

  return {
    isFavorite: Boolean(favorite),
    isSaved: Boolean(readLaterItem),
    readLaterCount: readLaterCount ?? 0,
  };
}

export async function recordPaperInteraction(
  ownerId: string,
  paperId: string,
  action: InteractionType,
  context = "feed",
) {
  const supabase = createServiceRoleClient();
  await mutateWithProfileRetry(ownerId, `Record ${action} interaction`, () =>
    supabase.from("user_paper_interactions").insert({
      owner_id: ownerId,
      paper_id: paperId,
      action,
      context,
    }),
  );
}

export async function toggleFavorite(ownerId: string, paperId: string) {
  const supabase = createServiceRoleClient();
  const { data: existing, error: existingError } = await supabase
    .from("favorites")
    .select("paper_id")
    .eq("owner_id", ownerId)
    .eq("paper_id", paperId)
    .maybeSingle();

  assertNoError(existingError, "Find favorite");

  if (existing) {
    const { error } = await supabase
      .from("favorites")
      .delete()
      .eq("owner_id", ownerId)
      .eq("paper_id", paperId);

    assertNoError(error, "Remove favorite");
    return;
  }

  await mutateWithProfileRetry(ownerId, "Add favorite", () =>
    supabase.from("favorites").insert({
      owner_id: ownerId,
      paper_id: paperId,
    }),
  );
  await recordPaperInteraction(ownerId, paperId, "favorite");
}

export async function toggleReadLater(ownerId: string, paperId: string) {
  const supabase = createServiceRoleClient();
  const playlistId = await ensureReadLaterPlaylist(ownerId);
  const { data: existing, error: existingError } = await supabase
    .from("playlist_items")
    .select("paper_id")
    .eq("playlist_id", playlistId)
    .eq("paper_id", paperId)
    .maybeSingle();

  assertNoError(existingError, "Find Read later item");

  if (existing) {
    const { error } = await supabase
      .from("playlist_items")
      .delete()
      .eq("playlist_id", playlistId)
      .eq("paper_id", paperId);

    assertNoError(error, "Remove from Read later");
    return;
  }

  const { error } = await supabase.from("playlist_items").upsert(
    {
      playlist_id: playlistId,
      paper_id: paperId,
      position: 0,
    },
    { onConflict: "playlist_id,paper_id" },
  );

  assertNoError(error, "Save to Read later");
  await recordPaperInteraction(ownerId, paperId, "save_to_playlist");
}

export async function createPlaylist(ownerId: string, name: string) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("playlists")
    .insert({ owner_id: ownerId, name, is_default: false })
    .select("id, name")
    .single();

  assertNoError(error, "Create playlist");
  return data as { id: string; name: string };
}

export async function renamePlaylist(
  ownerId: string,
  playlistId: string,
  name: string,
) {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("playlists")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", playlistId)
    .eq("owner_id", ownerId)
    .neq("is_default", true);

  assertNoError(error, "Rename playlist");
}

export async function deletePlaylist(ownerId: string, playlistId: string) {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("playlists")
    .delete()
    .eq("id", playlistId)
    .eq("owner_id", ownerId)
    .neq("is_default", true);

  assertNoError(error, "Delete playlist");
}

export async function addToPlaylist(playlistId: string, paperId: string) {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("playlist_items")
    .upsert({ playlist_id: playlistId, paper_id: paperId, position: 0 }, { onConflict: "playlist_id,paper_id" });

  assertNoError(error, "Add to playlist");
}

export async function removeFromPlaylist(playlistId: string, paperId: string) {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("playlist_items")
    .delete()
    .eq("playlist_id", playlistId)
    .eq("paper_id", paperId);

  assertNoError(error, "Remove from playlist");
}
