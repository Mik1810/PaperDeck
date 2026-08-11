"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireOwnerId, requireUserContext } from "@/lib/auth/session";
import {
  ensureUserProfile,
  recordPaperInteraction,
  saveSelectedTopics,
  setFavoriteState,
  createPlaylist,
  createPlaylistWithPaper,
  renamePlaylist,
  deletePlaylist,
  addToPlaylist,
  removeFromPlaylist,
  reorderPlaylistItems,
  getDefaultOnboardingTopicIds,
  resolveRecommendationImpressionId,
  setPaperPlaylistMembership,
  type PaperPlaylistOption,
  type PlaylistSaveContext,
  clearFeedRecommendations,
  preloadInitialFeedRecommendations,
  getRankedFeedPapers,
  addPaperNote,
  deletePaperNote,
  PAPER_NOTE_MAX_LENGTH,
} from "@/lib/repositories/user-data";
import { refreshUserProfileEmbedding } from "@/lib/repositories/user-profile-embeddings";
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
import {
  archiveNotification,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/repositories/notifications";
import { respondResearchGroupInvitationInApp } from "@/lib/repositories/research-group-invitations";

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

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: string, label: string) {
  if (!uuidPattern.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function isPlaylistSaveContext(value: string): value is PlaylistSaveContext {
  return (
    value === "feed" ||
    value === "digest" ||
    value === "paper_detail" ||
    value === "group"
  );
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
  source: OnboardingPersonalizationSource,
) {
  after(async () => {
    try {
      const profileEmbedding = await refreshUserProfileEmbedding(ownerId);
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
  scheduleOnboardingPersonalization(user.ownerId, "save");

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
  scheduleOnboardingPersonalization(user.ownerId, "skip");

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

export type NotificationActionResult = {
  ok: boolean;
  message?: string;
  affectedCount?: number;
};

function revalidateNotificationViews() {
  revalidatePath("/notifications");
}

export async function markNotificationReadAction(
  notificationId: string,
): Promise<NotificationActionResult> {
  const ownerId = await requireOwnerId();
  const result = await markNotificationRead(
    ownerId,
    requireUuid(notificationId, "notification id"),
  );
  revalidateNotificationViews();
  return result
    ? { ok: true, affectedCount: 1 }
    : { ok: false, message: "This notification is no longer available." };
}

export async function markAllNotificationsReadAction(): Promise<NotificationActionResult> {
  const ownerId = await requireOwnerId();
  const affectedCount = await markAllNotificationsRead(ownerId);
  revalidateNotificationViews();
  return { ok: true, affectedCount };
}

export async function archiveNotificationAction(
  notificationId: string,
): Promise<NotificationActionResult> {
  const ownerId = await requireOwnerId();
  const result = await archiveNotification(
    ownerId,
    requireUuid(notificationId, "notification id"),
  );
  revalidateNotificationViews();
  return result
    ? { ok: true, affectedCount: 1 }
    : { ok: false, message: "This notification is no longer available." };
}

export async function respondNotificationFriendRequestAction(
  notificationId: string,
  requestId: string,
  accept: boolean,
): Promise<NotificationActionResult> {
  requireUuid(notificationId, "notification id");
  requireUuid(requestId, "friend request id");
  const result = await respondFriendRequestAction(requestId, accept);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  const ownerId = await requireOwnerId();
  await markNotificationRead(ownerId, notificationId);
  revalidateNotificationViews();
  return { ok: true, affectedCount: 1 };
}

export async function respondNotificationGroupInvitationAction(
  notificationId: string,
  invitationId: string,
  accept: boolean,
): Promise<NotificationActionResult> {
  const ownerId = await requireOwnerId();
  requireUuid(notificationId, "notification id");
  requireUuid(invitationId, "group invitation id");
  try {
    await respondResearchGroupInvitationInApp(ownerId, invitationId, accept);
  } catch {
    return {
      ok: false,
      message: "This group invitation is no longer available.",
    };
  }

  await markNotificationRead(ownerId, notificationId);
  revalidateNotificationViews();
  return { ok: true, affectedCount: 1 };
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
  await refreshUserProfileEmbedding(ownerId);
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

export async function removeFavoriteAction(formData: FormData) {
  const ownerId = await requireOwnerId();
  const paperId = requirePaperId(formData);

  await setFavoriteState(ownerId, paperId, false);

  revalidatePath(sourcePathFrom(formData, "/feed"));
}

type PlaylistPickerMutationInput = {
  context: PlaylistSaveContext;
  paperId: string;
  recommendationImpressionId?: string;
};

export type PlaylistPickerActionResult = {
  ok: boolean;
  created?: boolean;
  option?: PaperPlaylistOption;
  message?: string;
};

function validatePlaylistPickerInput(input: PlaylistPickerMutationInput) {
  if (!uuidPattern.test(input.paperId) || !isPlaylistSaveContext(input.context)) {
    throw new Error("Invalid playlist request");
  }
  if (
    input.recommendationImpressionId &&
    !uuidPattern.test(input.recommendationImpressionId)
  ) {
    throw new Error("Invalid playlist request");
  }
}

function revalidatePlaylistPickerPaths(
  paperId: string,
  context: PlaylistSaveContext,
) {
  revalidatePath("/library");
  revalidatePath(
    context === "feed"
      ? "/feed"
      : context === "digest"
        ? "/digest"
        : context === "group"
          ? "/groups"
          : `/papers/${paperId}`,
  );
}

export async function setPaperPlaylistMembershipAction(
  input: PlaylistPickerMutationInput & {
    playlistId: string;
    selected: boolean;
  },
): Promise<PlaylistPickerActionResult> {
  const ownerId = await requireOwnerId();

  try {
    validatePlaylistPickerInput(input);
    if (!uuidPattern.test(input.playlistId)) {
      throw new Error("Invalid playlist request");
    }
    const recommendationImpressionId =
      input.context === "feed"
        ? await resolveRecommendationImpressionId(
            ownerId,
            input.paperId,
            input.recommendationImpressionId ?? null,
          )
        : null;
    const result = await setPaperPlaylistMembership(
      ownerId,
      input.paperId,
      input.playlistId,
      input.selected,
      input.context,
      { recommendationImpressionId },
    );
    revalidatePlaylistPickerPaths(input.paperId, input.context);
    return { ok: true, created: result.created };
  } catch {
    return {
      ok: false,
      message: "This playlist could not be updated.",
    };
  }
}

export async function createPlaylistWithPaperAction(
  input: PlaylistPickerMutationInput & { name: string },
): Promise<PlaylistPickerActionResult> {
  const ownerId = await requireOwnerId();

  try {
    validatePlaylistPickerInput(input);
    const name = input.name.trim().slice(0, 80);
    if (!name) throw new Error("Playlist name is required");
    const recommendationImpressionId =
      input.context === "feed"
        ? await resolveRecommendationImpressionId(
            ownerId,
            input.paperId,
            input.recommendationImpressionId ?? null,
          )
        : null;
    const option = await createPlaylistWithPaper(
      ownerId,
      input.paperId,
      name,
      input.context,
      { recommendationImpressionId },
    );
    revalidatePlaylistPickerPaths(input.paperId, input.context);
    return { ok: true, created: true, option };
  } catch {
    return {
      ok: false,
      message: "This playlist could not be created.",
    };
  }
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
