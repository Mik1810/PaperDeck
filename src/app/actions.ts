"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
} from "@/lib/repositories/user-data";
import { refreshUserProfileEmbedding } from "@/lib/repositories/user-profile-embeddings";
import { createClerkAuthenticatedClient } from "@/lib/supabase/server";

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

export async function saveOnboardingInterestsAction(formData: FormData) {
  const user = await requireUserContext();
  await ensureUserProfile(user);

  const topicIds = formData
    .getAll("topicId")
    .filter((topicId): topicId is string => typeof topicId === "string");

  await saveSelectedTopics(user.ownerId, topicIds);
  await refreshUserProfileEmbedding(user.ownerId);

  revalidatePath("/feed");
  revalidatePath("/onboarding");
  revalidatePath("/settings");
  redirect("/feed");
}

export async function saveSettingsInterestsAction(topicIds: string[]) {
  const ownerId = await requireOwnerId();

  await saveSelectedTopics(ownerId, topicIds);
  await refreshUserProfileEmbedding(ownerId);

  revalidatePath("/feed");
  revalidatePath("/settings");
  revalidatePath("/library");
}

export async function dismissPaperAction(formData: FormData) {
  const ownerId = await requireOwnerId();
  await recordPaperInteraction(ownerId, requirePaperId(formData), "dismiss");

  revalidatePath(sourcePathFrom(formData, "/feed"));
}

export async function openPaperAction(formData: FormData) {
  const ownerId = await requireOwnerId();
  const paperId = requirePaperId(formData);

  await recordPaperInteraction(ownerId, paperId, "open_detail");

  revalidatePath(sourcePathFrom(formData, "/feed"));
  redirect(`/papers/${paperId}`);
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
  await requireOwnerId();
  const playlistId = formData.get("playlistId");
  const paperId = formData.get("paperId");

  if (typeof playlistId !== "string" || typeof paperId !== "string") {
    throw new Error("Missing playlistId or paperId");
  }

  await addToPlaylist(playlistId, paperId);
  revalidatePath("/library");
}

export async function removeFromPlaylistAction(formData: FormData) {
  await requireOwnerId();
  const playlistId = formData.get("playlistId");
  const paperId = formData.get("paperId");

  if (typeof playlistId !== "string" || typeof paperId !== "string") {
    throw new Error("Missing playlistId or paperId");
  }

  await removeFromPlaylist(playlistId, paperId);
  revalidatePath("/library");
}

export async function reorderPlaylistAction(formData: FormData) {
  await requireOwnerId();
  const playlistId = formData.get("playlistId") as string;
  const paperIds = formData.getAll("paperId") as string[];

  if (!playlistId || !paperIds.length) {
    throw new Error("Missing playlistId or paperIds");
  }

  await reorderPlaylistItems(playlistId, paperIds);
  revalidatePath("/library");
}
