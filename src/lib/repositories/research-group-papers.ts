import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireOwnerId } from "@/lib/repositories/owner-guard";

export const RESEARCH_GROUP_PAPER_LIMIT = 500;

export const researchGroupPaperNotificationPreferences = [
  "all",
  "important_only",
  "muted",
] as const;

export type ResearchGroupPaperNotificationPreference =
  (typeof researchGroupPaperNotificationPreferences)[number];

function isNotificationPreference(
  value: string,
): value is ResearchGroupPaperNotificationPreference {
  return researchGroupPaperNotificationPreferences.some(
    (preference) => preference === value,
  );
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

  return rows.rows[0] ?? { changed: false, activity_id: null };
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

  return rows.rows[0] ?? { changed: false, activity_id: null };
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

  return rows.rows[0]?.changed ?? false;
}
