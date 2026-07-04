"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireOwnerId, requireUserContext } from "@/lib/auth/session";
import {
  ensureUserProfile,
  recordPaperInteraction,
  saveSelectedTopics,
  toggleReadLater,
  toggleFavorite,
  createPlaylist,
  renamePlaylist,
  deletePlaylist,
  addToPlaylist,
  removeFromPlaylist,
  reorderPlaylistItems,
  getDefaultOnboardingTopicIds,
  clearInitialFeedRecommendations,
  preloadInitialFeedRecommendations,
} from "@/lib/repositories/user-data";
import {
  writeTopicSelectionProfileEmbedding,
} from "@/lib/repositories/user-profile-embeddings";
import { createClerkAuthenticatedClient } from "@/lib/supabase/server";

type OnboardingPersonalizationSource = "save" | "skip";

function requirePaperId(formData: FormData) {
  const paperId = formData.get("paperId");

  if (typeof paperId !== "string" || !paperId) {
    throw new Error("Missing paperId");
  }

  return paperId;
}

function sourcePathFrom(formData: FormData, fallback: string) {
  const sourcePath = formData.get("sourcePath");

  if (typeof sourcePath !== "string") {
    return fallback;
  }

  if (
    sourcePath === "/feed" ||
    sourcePath === "/library" ||
    sourcePath === "/onboarding" ||
    sourcePath === "/settings" ||
    /^\/papers\/[0-9a-f-]+$/i.test(sourcePath)
  ) {
    return sourcePath;
  }

  return fallback;
}

function scheduleOnboardingPersonalization(
  ownerId: string,
  topicIds: string[],
  source: OnboardingPersonalizationSource,
) {
  const selectedTopicIds = [...new Set(topicIds)];

  after(async () => {
    try {
      const profileEmbedding = await writeTopicSelectionProfileEmbedding(
        ownerId,
        selectedTopicIds,
      );
      const recommendationBatch = await preloadInitialFeedRecommendations(ownerId);

      console.info(
        JSON.stringify({
          event: "onboarding_personalization_completed",
          source,
          profileEmbedding,
          recommendationBatch,
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "onboarding_personalization_failed",
          source,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });
}

export async function saveOnboardingInterestsAction(formData: FormData) {
  const user = await requireUserContext();
  await ensureUserProfile(user);

  const topicIds = formData
    .getAll("topicId")
    .filter((topicId): topicId is string => typeof topicId === "string");

  await saveSelectedTopics(user.ownerId, topicIds);
  scheduleOnboardingPersonalization(user.ownerId, topicIds, "save");

  revalidatePath("/feed");
  revalidatePath("/onboarding");
  revalidatePath("/settings");
  redirect("/feed");
}

export async function skipOnboardingAction() {
  const user = await requireUserContext();
  await ensureUserProfile(user);

  const topicIds = await getDefaultOnboardingTopicIds();

  await saveSelectedTopics(user.ownerId, topicIds);
  scheduleOnboardingPersonalization(user.ownerId, topicIds, "skip");

  revalidatePath("/feed");
  revalidatePath("/onboarding");
  revalidatePath("/settings");
  redirect("/feed");
}

export async function saveSettingsInterestsAction(topicIds: string[]) {
  const ownerId = await requireOwnerId();

  await saveSelectedTopics(ownerId, topicIds);
  await writeTopicSelectionProfileEmbedding(ownerId, topicIds);
  await clearInitialFeedRecommendations(ownerId);

  revalidatePath("/feed");
  revalidatePath("/settings");
  revalidatePath("/library");
}

export async function dismissPaperAction(formData: FormData) {
  const ownerId = await requireOwnerId();
  await recordPaperInteraction(ownerId, requirePaperId(formData), "dismiss");

  revalidatePath(sourcePathFrom(formData, "/feed"));
}

export async function toggleFavoriteAction(formData: FormData) {
  const ownerId = await requireOwnerId();
  const paperId = requirePaperId(formData);

  await toggleFavorite(ownerId, paperId);

  revalidatePath(sourcePathFrom(formData, "/feed"));
}

export async function toggleReadLaterAction(formData: FormData) {
  const ownerId = await requireOwnerId();
  const paperId = requirePaperId(formData);

  await toggleReadLater(ownerId, paperId);

  revalidatePath(sourcePathFrom(formData, "/feed"));
}

export async function verifyClerkRlsAction() {
  const supabase = await createClerkAuthenticatedClient();

  const { count, error } = await supabase
    .from("user_interests")
    .select("*", { count: "exact", head: true });

  if (error) {
    throw new Error(`RLS verification failed: ${error.message}`);
  }

  return { count: count ?? 0 };
}

export async function createPlaylistAction(formData: FormData) {
  const ownerId = await requireOwnerId();
  const name = formData.get("name");

  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Playlist name is required");
  }

  await createPlaylist(ownerId, name.trim());
  revalidatePath("/library");
}

export async function renamePlaylistAction(formData: FormData) {
  const ownerId = await requireOwnerId();
  const playlistId = requirePaperId(formData);
  const name = formData.get("name");

  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Playlist name is required");
  }

  await renamePlaylist(ownerId, playlistId, name.trim());
  revalidatePath("/library");
}

export async function deletePlaylistAction(formData: FormData) {
  const ownerId = await requireOwnerId();
  const playlistId = requirePaperId(formData);

  await deletePlaylist(ownerId, playlistId);
  revalidatePath("/library");
}

export async function addToPlaylistAction(formData: FormData) {
  const ownerId = await requireOwnerId();
  const playlistId = formData.get("playlistId");
  const paperId = formData.get("paperId");

  if (
    typeof playlistId !== "string" ||
    !playlistId ||
    typeof paperId !== "string" ||
    !paperId
  ) {
    throw new Error("Missing playlistId or paperId");
  }

  await addToPlaylist(ownerId, playlistId, paperId);
  revalidatePath("/library");
}

export async function removeFromPlaylistAction(formData: FormData) {
  const ownerId = await requireOwnerId();
  const playlistId = formData.get("playlistId");
  const paperId = formData.get("paperId");

  if (
    typeof playlistId !== "string" ||
    !playlistId ||
    typeof paperId !== "string" ||
    !paperId
  ) {
    throw new Error("Missing playlistId or paperId");
  }

  await removeFromPlaylist(ownerId, playlistId, paperId);
  revalidatePath("/library");
}

export async function reorderPlaylistAction(formData: FormData) {
  const ownerId = await requireOwnerId();
  const playlistId = formData.get("playlistId");
  const paperIds = formData
    .getAll("paperId")
    .filter(
      (paperId): paperId is string =>
        typeof paperId === "string" && Boolean(paperId),
    );

  if (typeof playlistId !== "string" || !playlistId || !paperIds.length) {
    throw new Error("Missing playlistId or paperIds");
  }

  await reorderPlaylistItems(ownerId, playlistId, paperIds);
  revalidatePath("/library");
}
