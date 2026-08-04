import "server-only";

import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  collaborationIdentities,
  friendRequests,
  notifications,
  profiles,
  researchGroupInvitations,
  researchGroups,
} from "@/db/schema";
import { requireOwnerId } from "@/lib/repositories/owner-guard";

const actorProfiles = alias(profiles, "notification_actor_profiles");
const actorIdentities = alias(
  collaborationIdentities,
  "notification_actor_identities",
);

export type NotificationCursor = {
  createdAt: string;
  id: string;
};

export type NotificationCategory = "all" | "requests" | "groups";
export type NotificationReadState = "all" | "unread" | "read";

export type NotificationSummary = {
  id: string;
  type: typeof notifications.$inferSelect.type;
  actor: {
    publicId: string;
    displayName: string | null;
    imageUrl: string | null;
  } | null;
  friendRequestId: string | null;
  friendRequestStatus: "pending" | "accepted" | "declined" | "cancelled" | null;
  groupInvitationId: string | null;
  groupInvitationStatus:
    | "pending"
    | "accepted"
    | "declined"
    | "cancelled"
    | "revoked"
    | "expired"
    | null;
  group: {
    id: string;
    name: string;
  } | null;
  readAt: string | null;
  createdAt: string;
  expiresAt: string;
};

function normalizeLimit(limit: number | undefined) {
  if (limit === undefined) {
    return 20;
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Notification page size must be an integer from 1 to 100.");
  }

  return limit;
}

/** @user-scoped */
export async function listNotifications(
  ownerId: string,
  options: {
    limit?: number;
    before?: NotificationCursor;
    category?: NotificationCategory;
    readState?: NotificationReadState;
  } = {},
): Promise<NotificationSummary[]> {
  requireOwnerId(ownerId, "listNotifications");
  const limit = normalizeLimit(options.limit);
  const cursorCondition = options.before
    ? or(
        lt(notifications.createdAt, options.before.createdAt),
        and(
          eq(notifications.createdAt, options.before.createdAt),
          lt(notifications.id, options.before.id),
        ),
      )
    : undefined;

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      actorPublicId: actorIdentities.publicId,
      actorDisplayName: actorProfiles.displayName,
      actorImageUrl: actorProfiles.imageUrl,
      friendRequestId: notifications.friendRequestId,
      friendRequestStatus: friendRequests.status,
      groupInvitationId: notifications.groupInvitationId,
      groupInvitationStatus: researchGroupInvitations.status,
      groupId: researchGroups.id,
      groupName: researchGroups.name,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      expiresAt: notifications.expiresAt,
    })
    .from(notifications)
    .leftJoin(actorProfiles, eq(actorProfiles.ownerId, notifications.actorId))
    .leftJoin(
      actorIdentities,
      eq(actorIdentities.ownerId, notifications.actorId),
    )
    .leftJoin(friendRequests, eq(friendRequests.id, notifications.friendRequestId))
    .leftJoin(
      researchGroupInvitations,
      eq(researchGroupInvitations.id, notifications.groupInvitationId),
    )
    .leftJoin(researchGroups, eq(researchGroups.id, notifications.groupId))
    .where(
      and(
        eq(notifications.recipientId, ownerId),
        isNull(notifications.archivedAt),
        sql`${notifications.expiresAt} > now()`,
        options.category === "requests"
          ? inArray(notifications.type, [
              "friend_request_received",
              "friendship_accepted",
            ])
          : options.category === "groups"
            ? inArray(notifications.type, [
                "group_invitation_received",
                "group_invitation_accepted",
                "group_member_joined",
                "group_membership_ended",
                "group_role_changed",
                "group_ownership_transferred",
              ])
            : undefined,
        options.readState === "unread"
          ? isNull(notifications.readAt)
          : options.readState === "read"
            ? isNotNull(notifications.readAt)
            : undefined,
        cursorCondition,
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    actor: row.actorPublicId
      ? {
          publicId: row.actorPublicId,
          displayName: row.actorDisplayName,
          imageUrl: row.actorImageUrl,
        }
      : null,
    friendRequestId: row.friendRequestId,
    friendRequestStatus: row.friendRequestStatus,
    groupInvitationId: row.groupInvitationId,
    groupInvitationStatus: row.groupInvitationStatus,
    group:
      row.groupId && row.groupName
        ? {
            id: row.groupId,
            name: row.groupName,
          }
        : null,
    readAt: row.readAt,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  }));
}

/** @user-scoped */
export async function countUnreadNotifications(ownerId: string) {
  requireOwnerId(ownerId, "countUnreadNotifications");

  const rows = await db
    .select({ count: sql<number>`count(*)::integer` })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientId, ownerId),
        isNull(notifications.readAt),
        isNull(notifications.archivedAt),
        sql`${notifications.expiresAt} > now()`,
      ),
    );

  return rows[0]?.count ?? 0;
}

/** @user-scoped */
export async function markNotificationRead(ownerId: string, id: string) {
  requireOwnerId(ownerId, "markNotificationRead");

  const rows = await db
    .update(notifications)
    .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.recipientId, ownerId),
        isNull(notifications.archivedAt),
        sql`${notifications.expiresAt} > now()`,
      ),
    )
    .returning({ id: notifications.id, readAt: notifications.readAt });

  return rows[0] ?? null;
}

/** @user-scoped */
export async function markAllNotificationsRead(ownerId: string) {
  requireOwnerId(ownerId, "markAllNotificationsRead");

  const rows = await db
    .update(notifications)
    .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(
      and(
        eq(notifications.recipientId, ownerId),
        isNull(notifications.readAt),
        isNull(notifications.archivedAt),
        sql`${notifications.expiresAt} > now()`,
      ),
    )
    .returning({ id: notifications.id });

  return rows.length;
}

/** @user-scoped */
export async function archiveNotification(ownerId: string, id: string) {
  requireOwnerId(ownerId, "archiveNotification");

  const rows = await db
    .update(notifications)
    .set({ archivedAt: sql`coalesce(${notifications.archivedAt}, now())` })
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.recipientId, ownerId),
        sql`${notifications.expiresAt} > now()`,
      ),
    )
    .returning({ id: notifications.id, archivedAt: notifications.archivedAt });

  return rows[0] ?? null;
}
