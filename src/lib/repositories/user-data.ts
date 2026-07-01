import "server-only";

import { getAllPapers, getPapersByIds, getTopics } from "@/lib/repositories/catalog";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { AuthenticatedUserContext } from "@/lib/auth/session";
import type { Paper, Playlist } from "@/types/paper";

type TopicRow = Awaited<ReturnType<typeof getTopics>>[number];

type UserPaperState = {
  favoriteIds: Set<string>;
  readLaterIds: Set<string>;
  dismissedIds: Set<string>;
};

function assertNoError(error: { message: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
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

export async function ensureReadLaterPlaylist(ownerId: string) {
  const supabase = createServiceRoleClient();
  const { data: existing, error: existingError } = await supabase
    .from("playlists")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("name", "Read later")
    .maybeSingle();

  assertNoError(existingError, "Find Read later playlist");

  if (existing) {
    return existing.id as string;
  }

  const { data: created, error: createError } = await supabase
    .from("playlists")
    .insert({
      owner_id: ownerId,
      name: "Read later",
      description: "Default private queue for papers to revisit.",
      is_default: true,
    })
    .select("id")
    .single();

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
  const readLaterPlaylistId = await ensureReadLaterPlaylist(ownerId);

  const [
    { data: favorites, error: favoritesError },
    { data: playlistItems, error: playlistItemsError },
    { data: interactions, error: interactionsError },
  ] = await Promise.all([
    supabase.from("favorites").select("paper_id").eq("owner_id", ownerId),
    supabase
      .from("playlist_items")
      .select("paper_id")
      .eq("playlist_id", readLaterPlaylistId),
    supabase
      .from("user_paper_interactions")
      .select("paper_id, action")
      .eq("owner_id", ownerId)
      .in("action", ["dismiss", "not_interested", "already_read"]),
  ]);

  assertNoError(favoritesError, "Load favorites");
  assertNoError(playlistItemsError, "Load Read later items");
  assertNoError(interactionsError, "Load negative interactions");

  return {
    favoriteIds: new Set((favorites ?? []).map((item) => item.paper_id as string)),
    readLaterIds: new Set(
      (playlistItems ?? []).map((item) => item.paper_id as string),
    ),
    dismissedIds: new Set(
      (interactions ?? []).map((item) => item.paper_id as string),
    ),
  };
}

function scorePaper(paper: Paper, selectedTopicIds: Set<string>) {
  const topicMatchCount = paper.topics.filter((topic) =>
    selectedTopicIds.has(topic.id),
  ).length;
  const relevanceScore = topicMatchCount * 100;
  const classicScore = paper.isClassic ? 8 : 0;
  const citationScore = Math.min(paper.citationCount ?? 0, 250) / 50;

  return relevanceScore + classicScore + citationScore + paper.year / 10000;
}

export async function getFeedPageData(ownerId: string) {
  const [papers, selectedTopicIds, state] = await Promise.all([
    getAllPapers(),
    getSelectedTopicIds(ownerId),
    getUserPaperState(ownerId),
  ]);

  const rankedPapers = papers
    .filter((paper) => !state.dismissedIds.has(paper.id))
    .sort((a, b) => scorePaper(b, selectedTopicIds) - scorePaper(a, selectedTopicIds));

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
  const readLaterPlaylistId = await ensureReadLaterPlaylist(ownerId);

  const [
    { data: playlists, error: playlistsError },
    { data: favoriteRows, error: favoritesError },
    { data: readLaterRows, error: readLaterError },
  ] = await Promise.all([
    supabase
      .from("playlists")
      .select("id, name, playlist_items(paper_id)")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: true }),
    supabase.from("favorites").select("paper_id").eq("owner_id", ownerId),
    supabase
      .from("playlist_items")
      .select("paper_id")
      .eq("playlist_id", readLaterPlaylistId)
      .order("added_at", { ascending: false }),
  ]);

  assertNoError(playlistsError, "Load playlists");
  assertNoError(favoritesError, "Load library favorites");
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
    getUserPaperState(ownerId),
  ]);

  return {
    paper: papers[0] ?? null,
    isFavorite: state.favoriteIds.has(paperId),
    isSaved: state.readLaterIds.has(paperId),
    readLaterCount: state.readLaterIds.size,
  };
}

export async function recordPaperInteraction(
  ownerId: string,
  paperId: string,
  action:
    | "open_detail"
    | "dismiss"
    | "favorite"
    | "save_to_playlist"
    | "read"
    | "already_read",
  context = "feed",
) {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("user_paper_interactions").insert({
    owner_id: ownerId,
    paper_id: paperId,
    action,
    context,
  });

  assertNoError(error, `Record ${action} interaction`);
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

  const { error } = await supabase.from("favorites").insert({
    owner_id: ownerId,
    paper_id: paperId,
  });

  assertNoError(error, "Add favorite");
  await recordPaperInteraction(ownerId, paperId, "favorite");
}

export async function saveToReadLater(ownerId: string, paperId: string) {
  const supabase = createServiceRoleClient();
  const playlistId = await ensureReadLaterPlaylist(ownerId);

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
