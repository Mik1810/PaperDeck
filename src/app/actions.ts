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
  clearFeedRecommendations,
  preloadInitialFeedRecommendations,
  getRankedFeedPapers,
  addPaperNote,
  deletePaperNote,
  PAPER_NOTE_MAX_LENGTH,
} from "@/lib/repositories/user-data";
import {
  writeTopicSelectionProfileEmbedding,
} from "@/lib/repositories/user-profile-embeddings";
import { logger } from "@/lib/logging/logger";
import { createClerkAuthenticatedClient } from "@/lib/supabase/server";
import { emailLookupHash } from "@/lib/collaboration/email-lookup";
import {
  isGroupInvitePolicy,
  validatePublicDisplayName,
} from "@/lib/collaboration/profile";
import {
  getCollaborationSettings,
  type RelationshipStatus,
  savePublicDisplayName,
  syncCollaborationIdentity,
} from "@/lib/repositories/collaboration";

type OnboardingPersonalizationSource = "save" | "skip";

function requireFormId(formData: FormData, field: string) {
  const value = formData.get(field);

  if (typeof value !== "string" || !value) {
    throw new Error(`Missing ${field}`);
  }

  return value;
}

function requirePaperId(formData: FormData) {
  return requireFormId(formData, "paperId");
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

      logger.info("onboarding_personalization_completed", {
        ownerId,
        source,
        profileEmbedding,
        recommendationBatch,
      });
    } catch (error) {
      logger.error("onboarding_personalization_failed", {
        ownerId,
        source,
        error,
      });
    }
  });
}

export async function saveOnboardingInterestsAction(formData: FormData) {
  const user = await requireUserContext();
  await ensureUserProfile(user);
  await savePublicDisplayName(
    user.ownerId,
    requireFormId(formData, "displayName"),
  );
  await syncCollaborationIdentity(user);

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

export async function skipOnboardingAction(formData: FormData) {
  const user = await requireUserContext();
  await ensureUserProfile(user);
  await savePublicDisplayName(
    user.ownerId,
    requireFormId(formData, "displayName"),
  );
  await syncCollaborationIdentity(user);

  const topicIds = await getDefaultOnboardingTopicIds();

  await saveSelectedTopics(user.ownerId, topicIds);
  scheduleOnboardingPersonalization(user.ownerId, topicIds, "skip");

  revalidatePath("/feed");
  revalidatePath("/onboarding");
  revalidatePath("/settings");
  redirect("/feed");
}

export async function saveCollaborationSettingsAction(input: {
  displayName: string;
  discoverableByEmail: boolean;
  groupInvitePolicy: string;
}) {
  const user = await requireUserContext();

  if (!isGroupInvitePolicy(input.groupInvitePolicy)) {
    throw new Error("Invalid group invitation policy.");
  }

  await ensureUserProfile(user);
  await savePublicDisplayName(user.ownerId, input.displayName);
  await syncCollaborationIdentity(user, {
    discoverableByEmail: input.discoverableByEmail,
    groupInvitePolicy: input.groupInvitePolicy,
  });

  revalidatePath("/settings");
  revalidatePath("/search");
}

export type CollaborationSearchResult =
  | { status: "idle" | "unavailable" | "rate_limited"; profile?: never }
  | {
      status: "found";
      profile: {
        publicId: string;
        displayName: string;
        imageUrl: string | null;
        relationshipStatus: Exclude<RelationshipStatus, "blocked">;
        requestId: string | null;
      };
    };

export async function searchCollaborationProfileAction(
  email: string,
): Promise<CollaborationSearchResult> {
  await requireOwnerId();

  let hash: string;
  try {
    hash = emailLookupHash(email);
  } catch {
    return { status: "unavailable" };
  }

  const supabase = await createClerkAuthenticatedClient();
  const { data, error } = await supabase.rpc("find_collaboration_profile", {
    p_email_lookup_hash: hash,
  });

  if (error) {
    if (error.message.includes("rate_limit_exceeded")) {
      return { status: "rate_limited" };
    }
    return { status: "unavailable" };
  }

  const profile = data?.[0];
  if (!profile) {
    return { status: "unavailable" };
  }
  const relationshipStatus = profile.relationship_status;
  if (
    relationshipStatus !== "none" &&
    relationshipStatus !== "incoming_pending" &&
    relationshipStatus !== "outgoing_pending" &&
    relationshipStatus !== "friends"
  ) {
    return { status: "unavailable" };
  }

  return {
    status: "found",
    profile: {
      publicId: profile.public_id,
      displayName: validatePublicDisplayName(profile.display_name),
      imageUrl: profile.image_url,
      relationshipStatus,
      requestId: typeof profile.request_id === "string" ? profile.request_id : null,
    },
  };
}

export type FriendActionResult = {
  ok: boolean;
  relationshipStatus?: Exclude<RelationshipStatus, "blocked">;
  requestId?: string | null;
  message?: string;
};

function friendActionError(message: string): FriendActionResult {
  if (message.includes("public_profile_required")) {
    return { ok: false, message: "Add a public name in Settings before sending requests." };
  }
  if (message.includes("friend_request_cooldown")) {
    return {
      ok: false,
      message: "A declined request cannot be retried for 30 days.",
    };
  }
  if (message.includes("friend_request_rate_limited")) {
    return { ok: false, message: "You can send at most 10 requests per day." };
  }
  return { ok: false, message: "This profile or request is unavailable." };
}

async function ensureFriendshipActor() {
  const user = await requireUserContext();
  await ensureUserProfile(user);
  const settings = await getCollaborationSettings(user.ownerId);
  validatePublicDisplayName(settings.displayName);
  await syncCollaborationIdentity(user);
}

async function friendshipRpc(
  functionName: string,
  parameters: Record<string, unknown>,
) {
  await requireOwnerId();
  const supabase = await createClerkAuthenticatedClient();
  return supabase.rpc(functionName, parameters);
}

export async function sendFriendRequestAction(
  publicId: string,
): Promise<FriendActionResult> {
  try {
    await ensureFriendshipActor();
  } catch {
    return friendActionError("public_profile_required");
  }
  const { data, error } = await friendshipRpc("send_friend_request", {
    p_target_public_id: publicId,
  });
  if (error) return friendActionError(error.message);
  const result = data?.[0];
  revalidatePath("/search");
  revalidatePath("/settings");
  return {
    ok: true,
    relationshipStatus: result?.relationship_status ?? "outgoing_pending",
    requestId: result?.request_id ?? null,
  };
}

export async function respondFriendRequestAction(
  requestId: string,
  accept: boolean,
): Promise<FriendActionResult> {
  const { error } = await friendshipRpc("respond_friend_request", {
    p_request_id: requestId,
    p_accept: accept,
  });
  if (error) return friendActionError(error.message);
  revalidatePath("/search");
  revalidatePath("/settings");
  return { ok: true, relationshipStatus: accept ? "friends" : "none" };
}

export async function cancelFriendRequestAction(
  requestId: string,
): Promise<FriendActionResult> {
  const { error } = await friendshipRpc("cancel_friend_request", {
    p_request_id: requestId,
  });
  if (error) return friendActionError(error.message);
  revalidatePath("/search");
  revalidatePath("/settings");
  return { ok: true, relationshipStatus: "none" };
}

export async function unfriendProfileAction(
  publicId: string,
): Promise<FriendActionResult> {
  const { error } = await friendshipRpc("unfriend_profile", {
    p_target_public_id: publicId,
  });
  if (error) return friendActionError(error.message);
  revalidatePath("/search");
  revalidatePath("/settings");
  return { ok: true, relationshipStatus: "none" };
}

export async function blockProfileAction(
  publicId: string,
): Promise<FriendActionResult> {
  const { error } = await friendshipRpc("block_profile", {
    p_target_public_id: publicId,
  });
  if (error) return friendActionError(error.message);
  revalidatePath("/search");
  revalidatePath("/settings");
  return { ok: true };
}

export async function unblockProfileAction(
  publicId: string,
): Promise<FriendActionResult> {
  const { error } = await friendshipRpc("unblock_profile", {
    p_target_public_id: publicId,
  });
  if (error) return friendActionError(error.message);
  revalidatePath("/search");
  revalidatePath("/settings");
  return { ok: true, relationshipStatus: "none" };
}

export async function saveSettingsInterestsAction(topicIds: string[]) {
  const ownerId = await requireOwnerId();

  await saveSelectedTopics(ownerId, topicIds);
  await writeTopicSelectionProfileEmbedding(ownerId, topicIds);
  await clearFeedRecommendations(ownerId);

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
  const ownerId = await requireOwnerId();
  const supabase = await createClerkAuthenticatedClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("owner_id")
    .limit(10);

  if (error) {
    throw new Error(`RLS verification failed: ${error.message}`);
  }

  if (data.some((profile) => profile.owner_id !== ownerId)) {
    throw new Error("RLS verification failed: cross-owner profile was visible");
  }

  return {
    isolationVerified: true,
    visibleProfileCount: data.length,
  };
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
  const playlistId = requireFormId(formData, "playlistId");
  const name = formData.get("name");

  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Playlist name is required");
  }

  await renamePlaylist(ownerId, playlistId, name.trim());
  revalidatePath("/library");
}

export async function deletePlaylistAction(formData: FormData) {
  const ownerId = await requireOwnerId();
  const playlistId = requireFormId(formData, "playlistId");

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

export async function loadMoreDeckPapersAction() {
  const ownerId = await requireOwnerId();
  return await getRankedFeedPapers(ownerId);
}

export async function addPaperNoteAction(formData: FormData) {
  const ownerId = await requireOwnerId();
  const paperId = requirePaperId(formData);
  const body = formData.get("body");

  if (typeof body !== "string") {
    throw new Error("Missing note body");
  }

  await addPaperNote(ownerId, paperId, body.slice(0, PAPER_NOTE_MAX_LENGTH));
  revalidatePath(`/papers/${paperId}`);
}

export async function deletePaperNoteAction(formData: FormData) {
  const ownerId = await requireOwnerId();
  const paperId = requirePaperId(formData);
  const noteId = formData.get("noteId");

  if (typeof noteId !== "string" || !noteId) {
    throw new Error("Missing noteId");
  }

  await deletePaperNote(ownerId, paperId, noteId);
  revalidatePath(`/papers/${paperId}`);
}
