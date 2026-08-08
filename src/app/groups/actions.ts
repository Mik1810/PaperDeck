"use server";

import { revalidatePath } from "next/cache";
import { requireOwnerId, requireUserContext } from "@/lib/auth/session";
import { emailLookupHash } from "@/lib/collaboration/email-lookup";
import {
  createResearchGroup,
  deleteResearchGroup,
} from "@/lib/repositories/research-groups";
import {
  createResearchGroupInvitation,
  leaveResearchGroup,
  removeResearchGroupMember,
  respondResearchGroupInvitationInApp,
  setResearchGroupMemberRole,
} from "@/lib/repositories/research-group-invitations";
import {
  addResearchGroupPaper,
  removeResearchGroupPaper,
  researchGroupPaperNotificationPreferences,
  setResearchGroupPaperNotificationPreference,
  type ResearchGroupPaperNotificationPreference,
} from "@/lib/repositories/research-group-papers";
import { ensureUserProfile } from "@/lib/repositories/user-data";
import { createClerkAuthenticatedClient } from "@/lib/supabase/server";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type GroupActionResult = {
  ok: boolean;
  message?: string;
  groupId?: string;
  changed?: boolean;
};

function requireUuid(value: string) {
  if (!uuidPattern.test(value)) throw new Error("Invalid identifier.");
  return value;
}

function groupPath(groupId: string) {
  return `/groups/${groupId}`;
}

function actionFailure(message = "This group action is unavailable.") {
  return { ok: false, message } satisfies GroupActionResult;
}

export async function createResearchGroupAction(input: {
  name: string;
  description: string;
}): Promise<GroupActionResult> {
  const user = await requireUserContext();
  try {
    await ensureUserProfile(user);
    const group = await createResearchGroup(user.ownerId, input);
    revalidatePath("/groups");
    return { ok: true, groupId: group.id };
  } catch {
    return actionFailure("The group could not be created.");
  }
}

export async function addResearchGroupPaperAction(input: {
  groupId: string;
  paperId: string;
}): Promise<GroupActionResult> {
  const ownerId = await requireOwnerId();
  try {
    const groupId = requireUuid(input.groupId);
    const paperId = requireUuid(input.paperId);
    const result = await addResearchGroupPaper(ownerId, groupId, paperId);
    revalidatePath(groupPath(groupId));
    return { ok: true, changed: result.changed };
  } catch {
    return actionFailure("The paper could not be added to this group.");
  }
}

export async function removeResearchGroupPaperAction(input: {
  groupId: string;
  paperId: string;
}): Promise<GroupActionResult> {
  const ownerId = await requireOwnerId();
  try {
    const groupId = requireUuid(input.groupId);
    const paperId = requireUuid(input.paperId);
    const result = await removeResearchGroupPaper(ownerId, groupId, paperId);
    revalidatePath(groupPath(groupId));
    return { ok: true, changed: result.changed };
  } catch {
    return actionFailure("The paper could not be removed from this group.");
  }
}

export async function setGroupPaperNotificationPreferenceAction(input: {
  groupId: string;
  preference: string;
}): Promise<GroupActionResult> {
  const ownerId = await requireOwnerId();
  try {
    const groupId = requireUuid(input.groupId);
    if (
      !researchGroupPaperNotificationPreferences.includes(
        input.preference as ResearchGroupPaperNotificationPreference,
      )
    ) {
      throw new Error("Invalid preference.");
    }
    await setResearchGroupPaperNotificationPreference(
      ownerId,
      groupId,
      input.preference as ResearchGroupPaperNotificationPreference,
    );
    revalidatePath(groupPath(groupId));
    return { ok: true };
  } catch {
    return actionFailure("The notification preference could not be updated.");
  }
}

export async function inviteResearchGroupMemberAction(input: {
  groupId: string;
  email: string;
}): Promise<GroupActionResult> {
  const ownerId = await requireOwnerId();
  try {
    const groupId = requireUuid(input.groupId);
    const lookupHash = emailLookupHash(input.email);
    const supabase = await createClerkAuthenticatedClient();
    const { data, error } = await supabase.rpc("find_collaboration_profile", {
      p_email_lookup_hash: lookupHash,
    });
    const publicId = data?.[0]?.public_id;
    if (error || typeof publicId !== "string") {
      return actionFailure(
        "No eligible opted-in account was found for that exact address.",
      );
    }
    await createResearchGroupInvitation(ownerId, groupId, publicId);
    revalidatePath(groupPath(groupId));
    return { ok: true };
  } catch {
    return actionFailure("The invitation could not be created.");
  }
}

export async function respondResearchGroupInvitationAction(input: {
  invitationId: string;
  accept: boolean;
}): Promise<GroupActionResult> {
  const ownerId = await requireOwnerId();
  try {
    await respondResearchGroupInvitationInApp(
      ownerId,
      requireUuid(input.invitationId),
      input.accept,
    );
    revalidatePath("/groups");
    revalidatePath("/notifications");
    return { ok: true };
  } catch {
    return actionFailure("The invitation is no longer available.");
  }
}

export async function setResearchGroupMemberRoleAction(input: {
  groupId: string;
  memberPublicId: string;
  role: "admin" | "member";
}): Promise<GroupActionResult> {
  const ownerId = await requireOwnerId();
  try {
    const groupId = requireUuid(input.groupId);
    await setResearchGroupMemberRole(
      ownerId,
      groupId,
      requireUuid(input.memberPublicId),
      input.role,
    );
    revalidatePath(groupPath(groupId));
    return { ok: true };
  } catch {
    return actionFailure("This member role could not be changed.");
  }
}

export async function removeResearchGroupMemberAction(input: {
  groupId: string;
  memberPublicId: string;
}): Promise<GroupActionResult> {
  const ownerId = await requireOwnerId();
  try {
    const groupId = requireUuid(input.groupId);
    await removeResearchGroupMember(
      ownerId,
      groupId,
      requireUuid(input.memberPublicId),
    );
    revalidatePath(groupPath(groupId));
    return { ok: true };
  } catch {
    return actionFailure("This member could not be removed.");
  }
}

export async function leaveResearchGroupAction(
  groupIdValue: string,
): Promise<GroupActionResult> {
  const ownerId = await requireOwnerId();
  try {
    const groupId = requireUuid(groupIdValue);
    await leaveResearchGroup(ownerId, groupId);
    revalidatePath("/groups");
    return { ok: true };
  } catch {
    return actionFailure("You could not leave this group.");
  }
}

export async function deleteResearchGroupAction(
  groupIdValue: string,
): Promise<GroupActionResult> {
  const ownerId = await requireOwnerId();
  try {
    const groupId = requireUuid(groupIdValue);
    await deleteResearchGroup(ownerId, groupId);
    revalidatePath("/groups");
    return { ok: true };
  } catch {
    return actionFailure("This group could not be deleted.");
  }
}
