import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  collaborationIdentities,
  profiles,
  researchGroupMembers,
  researchGroupPaperItems,
} from "@/db/schema";
import { getPapersByIds } from "@/lib/repositories/catalog";
import { requireOwnerId } from "@/lib/repositories/owner-guard";
import { requireResearchGroupPermission } from "@/lib/repositories/research-groups";
import { ResearchGroupUnavailableError } from "@/lib/research-groups/permissions";
import type { Paper } from "@/types/paper";

const contributorMemberships = alias(
  researchGroupMembers,
  "shared_paper_contributor_memberships",
);
const contributorProfiles = alias(profiles, "shared_paper_contributor_profiles");
const contributorIdentities = alias(
  collaborationIdentities,
  "shared_paper_contributor_identities",
);

export const RESEARCH_GROUP_PAPER_LIMIT = 500;

export const researchGroupPaperNotificationPreferences = [
  "all",
  "important_only",
  "muted",
] as const;

export type ResearchGroupPaperNotificationPreference =
  (typeof researchGroupPaperNotificationPreferences)[number];

export type ResearchGroupPaperItem = {
  paper: Paper;
  contributor: {
    publicId: string;
    displayName: string | null;
    imageUrl: string | null;
  } | null;
  addedAt: string;
  canRemove: boolean;
};

function isNotificationPreference(
  value: string,
): value is ResearchGroupPaperNotificationPreference {
  return researchGroupPaperNotificationPreferences.some(
    (preference) => preference === value,
  );
}

/** @user-scoped */
export async function listResearchGroupPapers(
  actorOwnerId: string,
  groupId: string,
): Promise<ResearchGroupPaperItem[]> {
  requireOwnerId(actorOwnerId, "listResearchGroupPapers");
  const actorRole = await requireResearchGroupPermission(
    actorOwnerId,
    groupId,
    "member",
    "read",
  );

  const rows = await db
    .select({
      paperId: researchGroupPaperItems.paperId,
      addedBy: researchGroupPaperItems.addedBy,
      addedAt: researchGroupPaperItems.addedAt,
      contributorPublicId: contributorIdentities.publicId,
      contributorDisplayName: contributorProfiles.displayName,
      contributorImageUrl: contributorProfiles.imageUrl,
    })
    .from(researchGroupPaperItems)
    .leftJoin(
      contributorMemberships,
      and(
        eq(contributorMemberships.groupId, researchGroupPaperItems.groupId),
        eq(contributorMemberships.memberId, researchGroupPaperItems.addedBy),
        isNull(contributorMemberships.revokedAt),
      ),
    )
    .leftJoin(
      contributorProfiles,
      eq(contributorProfiles.ownerId, contributorMemberships.memberId),
    )
    .leftJoin(
      contributorIdentities,
      eq(contributorIdentities.ownerId, contributorMemberships.memberId),
    )
    .where(
      and(
        eq(researchGroupPaperItems.groupId, groupId),
        sql`exists (
          select 1
          from private.research_group_runtime_settings as settings
          where settings.singleton and settings.reads_enabled
        )`,
        sql`exists (
          select 1
          from research_group_members as actor_membership
          where actor_membership.group_id = ${groupId}::uuid
            and actor_membership.member_id = ${actorOwnerId}
            and actor_membership.revoked_at is null
        )`,
      ),
    )
    .orderBy(
      desc(researchGroupPaperItems.addedAt),
      desc(researchGroupPaperItems.paperId),
    )
    .limit(RESEARCH_GROUP_PAPER_LIMIT);

  const paperRows = await getPapersByIds(rows.map((row) => row.paperId));
  const papersById = new Map(paperRows.map((paper) => [paper.id, paper]));

  return rows.flatMap((row) => {
    const paper = papersById.get(row.paperId);
    if (!paper) return [];

    return [{
      paper,
      contributor: row.contributorPublicId
        ? {
            publicId: row.contributorPublicId,
            displayName: row.contributorDisplayName,
            imageUrl: row.contributorImageUrl,
          }
        : null,
      addedAt: row.addedAt,
      canRemove:
        actorRole === "owner" ||
        actorRole === "admin" ||
        row.addedBy === actorOwnerId,
    }];
  });
}

/** @user-scoped */
export async function getResearchGroupPaperNotificationPreference(
  actorOwnerId: string,
  groupId: string,
): Promise<ResearchGroupPaperNotificationPreference> {
  await requireResearchGroupPermission(
    actorOwnerId,
    groupId,
    "member",
    "read",
  );

  const rows = await db
    .select({
      preference: researchGroupMembers.paperNotificationPreference,
    })
    .from(researchGroupMembers)
    .where(
      and(
        eq(researchGroupMembers.groupId, groupId),
        eq(researchGroupMembers.memberId, actorOwnerId),
        isNull(researchGroupMembers.revokedAt),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new ResearchGroupUnavailableError();
  }
  return rows[0].preference;
}

/** @user-scoped */
export async function addResearchGroupPaper(
  actorOwnerId: string,
  groupId: string,
  paperId: string,
) {
  requireOwnerId(actorOwnerId, "addResearchGroupPaper");
  const rows = await db.execute<{
    changed: boolean;
    activity_id: string | null;
  }>(sql`
    select *
    from public.add_research_group_paper(
      ${actorOwnerId},
      ${groupId}::uuid,
      ${paperId}::uuid
    )
  `);

  return rows[0] ?? { changed: false, activity_id: null };
}

/** @user-scoped */
export async function removeResearchGroupPaper(
  actorOwnerId: string,
  groupId: string,
  paperId: string,
) {
  requireOwnerId(actorOwnerId, "removeResearchGroupPaper");
  const rows = await db.execute<{
    changed: boolean;
    activity_id: string | null;
  }>(sql`
    select *
    from public.remove_research_group_paper(
      ${actorOwnerId},
      ${groupId}::uuid,
      ${paperId}::uuid
    )
  `);

  return rows[0] ?? { changed: false, activity_id: null };
}

/** @user-scoped */
export async function setResearchGroupPaperNotificationPreference(
  actorOwnerId: string,
  groupId: string,
  preference: ResearchGroupPaperNotificationPreference,
) {
  requireOwnerId(
    actorOwnerId,
    "setResearchGroupPaperNotificationPreference",
  );
  if (!isNotificationPreference(preference)) {
    throw new Error("Invalid group paper notification preference.");
  }

  const rows = await db.execute<{ changed: boolean }>(sql`
    select public.set_research_group_paper_notification_preference(
      ${actorOwnerId},
      ${groupId}::uuid,
      ${preference}::public.research_group_paper_notification_preference
    ) as changed
  `);

  return rows[0]?.changed ?? false;
}
