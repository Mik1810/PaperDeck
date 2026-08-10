import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  collaborationIdentities,
  profiles,
  researchGroupInvitations,
  researchGroups,
} from "@/db/schema";
import {
  createResearchGroupInvitationToken,
  researchGroupInvitationTokenDigest,
} from "@/lib/research-groups/invitation-token";
import {
  ResearchGroupUnavailableError,
  type ResearchGroupRole,
} from "@/lib/research-groups/permissions";
import { requireOwnerId } from "@/lib/repositories/owner-guard";
import { requireResearchGroupPermission } from "@/lib/repositories/research-groups";

export type IncomingResearchGroupInvitation = {
  id: string;
  group: {
    id: string;
    name: string;
  };
  inviter: {
    publicId: string;
    displayName: string | null;
    imageUrl: string | null;
  };
  createdAt: string;
  expiresAt: string;
};

export type OutgoingResearchGroupInvitation = {
  id: string;
  recipient: {
    publicId: string;
    displayName: string | null;
    imageUrl: string | null;
  };
  status:
    | "pending"
    | "accepted"
    | "declined"
    | "cancelled"
    | "revoked"
    | "expired";
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
};

async function runInvitationMutation<T>(task: () => Promise<T>) {
  try {
    return await task();
  } catch {
    throw new ResearchGroupUnavailableError();
  }
}

/** @user-scoped */
export async function createResearchGroupInvitation(
  actorOwnerId: string,
  groupId: string,
  recipientPublicId: string,
) {
  requireOwnerId(actorOwnerId, "createResearchGroupInvitation");
  const token = createResearchGroupInvitationToken();
  const tokenDigest = researchGroupInvitationTokenDigest(token);

  const rows = await runInvitationMutation(() =>
    db.execute<{ invitation_id: string }>(sql`
      select create_research_group_invitation(
        ${actorOwnerId},
        ${groupId}::uuid,
        ${recipientPublicId}::uuid,
        ${tokenDigest}
      ) as invitation_id
    `),
  );
  const invitation = rows.rows[0];
  if (!invitation) {
    throw new ResearchGroupUnavailableError();
  }

  return { invitationId: invitation.invitation_id, token };
}

/** @user-scoped */
export async function respondResearchGroupInvitation(
  actorOwnerId: string,
  invitationId: string,
  token: string,
  accept: boolean,
) {
  requireOwnerId(actorOwnerId, "respondResearchGroupInvitation");
  let tokenDigest: string;
  try {
    tokenDigest = researchGroupInvitationTokenDigest(token);
  } catch {
    throw new ResearchGroupUnavailableError();
  }
  const rows = await runInvitationMutation(() =>
    db.execute<{ status: string }>(sql`
      select respond_research_group_invitation(
        ${actorOwnerId},
        ${invitationId}::uuid,
        ${tokenDigest},
        ${accept}
      ) as status
    `),
  );
  const status = rows.rows[0]?.status;
  if (status !== "accepted" && status !== "declined") {
    throw new ResearchGroupUnavailableError();
  }
  return status;
}

/** @user-scoped */
export async function respondResearchGroupInvitationInApp(
  actorOwnerId: string,
  invitationId: string,
  accept: boolean,
) {
  requireOwnerId(actorOwnerId, "respondResearchGroupInvitationInApp");
  const rows = await runInvitationMutation(() =>
    db.execute<{ status: string }>(sql`
      select respond_research_group_invitation_in_app(
        ${actorOwnerId},
        ${invitationId}::uuid,
        ${accept}
      ) as status
    `),
  );
  const status = rows.rows[0]?.status;
  if (status !== "accepted" && status !== "declined") {
    throw new ResearchGroupUnavailableError();
  }
  return status;
}

/** @user-scoped */
export async function cancelResearchGroupInvitation(
  actorOwnerId: string,
  invitationId: string,
) {
  requireOwnerId(actorOwnerId, "cancelResearchGroupInvitation");
  await runInvitationMutation(() =>
    db.execute(sql`
      select cancel_research_group_invitation(
        ${actorOwnerId},
        ${invitationId}::uuid
      )
    `),
  );
}

/** @user-scoped */
export async function revokeResearchGroupInvitation(
  actorOwnerId: string,
  invitationId: string,
) {
  requireOwnerId(actorOwnerId, "revokeResearchGroupInvitation");
  await runInvitationMutation(() =>
    db.execute(sql`
      select revoke_research_group_invitation(
        ${actorOwnerId},
        ${invitationId}::uuid
      )
    `),
  );
}

/** @user-scoped */
export async function setResearchGroupMemberRole(
  actorOwnerId: string,
  groupId: string,
  memberPublicId: string,
  role: Exclude<ResearchGroupRole, "owner">,
) {
  requireOwnerId(actorOwnerId, "setResearchGroupMemberRole");
  await runInvitationMutation(() =>
    db.execute(sql`
      select set_research_group_member_role(
        ${actorOwnerId},
        ${groupId}::uuid,
        ${memberPublicId}::uuid,
        ${role}::research_group_role
      )
    `),
  );
}

/** @user-scoped */
export async function removeResearchGroupMember(
  actorOwnerId: string,
  groupId: string,
  memberPublicId: string,
) {
  requireOwnerId(actorOwnerId, "removeResearchGroupMember");
  await runInvitationMutation(() =>
    db.execute(sql`
      select remove_research_group_member(
        ${actorOwnerId},
        ${groupId}::uuid,
        ${memberPublicId}::uuid
      )
    `),
  );
}

/** @user-scoped */
export async function leaveResearchGroup(
  actorOwnerId: string,
  groupId: string,
) {
  requireOwnerId(actorOwnerId, "leaveResearchGroup");
  await runInvitationMutation(() =>
    db.execute(sql`
      select leave_research_group(${actorOwnerId}, ${groupId}::uuid)
    `),
  );
}

/** @user-scoped */
export async function listIncomingResearchGroupInvitations(
  actorOwnerId: string,
): Promise<IncomingResearchGroupInvitation[]> {
  requireOwnerId(actorOwnerId, "listIncomingResearchGroupInvitations");

  return db
    .select({
      id: researchGroupInvitations.id,
      groupId: researchGroups.id,
      groupName: researchGroups.name,
      inviterPublicId: collaborationIdentities.publicId,
      inviterDisplayName: profiles.displayName,
      inviterImageUrl: profiles.imageUrl,
      createdAt: researchGroupInvitations.createdAt,
      expiresAt: researchGroupInvitations.expiresAt,
    })
    .from(researchGroupInvitations)
    .innerJoin(
      researchGroups,
      eq(researchGroups.id, researchGroupInvitations.groupId),
    )
    .innerJoin(
      collaborationIdentities,
      eq(collaborationIdentities.ownerId, researchGroupInvitations.inviterId),
    )
    .innerJoin(profiles, eq(profiles.ownerId, researchGroupInvitations.inviterId))
    .where(
      and(
        eq(researchGroupInvitations.recipientId, actorOwnerId),
        eq(researchGroupInvitations.status, "pending"),
        eq(researchGroups.state, "active"),
        isNull(researchGroupInvitations.resolvedAt),
        sql`${researchGroupInvitations.expiresAt} > now()`,
        sql`exists (
          select 1
          from private.research_group_runtime_settings as settings
          where settings.singleton and settings.reads_enabled
        )`,
      ),
    )
    .orderBy(desc(researchGroupInvitations.createdAt))
    .then((rows) =>
      rows.map((row) => ({
        id: row.id,
        group: { id: row.groupId, name: row.groupName },
        inviter: {
          publicId: row.inviterPublicId,
          displayName: row.inviterDisplayName,
          imageUrl: row.inviterImageUrl,
        },
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      })),
    );
}

/** @user-scoped */
export async function listOutgoingResearchGroupInvitations(
  actorOwnerId: string,
  groupId: string,
): Promise<OutgoingResearchGroupInvitation[]> {
  await requireResearchGroupPermission(actorOwnerId, groupId, "admin", "read");

  return db
    .select({
      id: researchGroupInvitations.id,
      recipientPublicId: collaborationIdentities.publicId,
      recipientDisplayName: profiles.displayName,
      recipientImageUrl: profiles.imageUrl,
      status: researchGroupInvitations.status,
      createdAt: researchGroupInvitations.createdAt,
      expiresAt: researchGroupInvitations.expiresAt,
      resolvedAt: researchGroupInvitations.resolvedAt,
    })
    .from(researchGroupInvitations)
    .innerJoin(
      collaborationIdentities,
      eq(collaborationIdentities.ownerId, researchGroupInvitations.recipientId),
    )
    .innerJoin(profiles, eq(profiles.ownerId, researchGroupInvitations.recipientId))
    .where(eq(researchGroupInvitations.groupId, groupId))
    .orderBy(desc(researchGroupInvitations.createdAt))
    .then((rows) =>
      rows.map((row) => ({
        id: row.id,
        recipient: {
          publicId: row.recipientPublicId,
          displayName: row.recipientDisplayName,
          imageUrl: row.recipientImageUrl,
        },
        status: row.status,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        resolvedAt: row.resolvedAt,
      })),
    );
}
