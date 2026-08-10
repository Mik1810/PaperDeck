import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  researchGroupMembers,
  researchGroups,
} from "@/db/schema";
import {
  assertResearchGroupPermission,
  ResearchGroupUnavailableError,
  type ResearchGroupOperation,
  type ResearchGroupRole,
} from "@/lib/research-groups/permissions";
import { requireOwnerId } from "@/lib/repositories/owner-guard";

type RuntimeSettings = {
  readsEnabled: boolean;
  writesEnabled: boolean;
};

export type ResearchGroupSummary = {
  id: string;
  name: string;
  description: string | null;
  role: ResearchGroupRole;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ResearchGroupMemberSummary = {
  publicId: string;
  displayName: string | null;
  imageUrl: string | null;
  role: ResearchGroupRole;
  joinedAt: string;
  isCurrentUser: boolean;
};

async function getRuntimeSettings(): Promise<RuntimeSettings> {
  const result = await db.execute<{
    reads_enabled: boolean;
    writes_enabled: boolean;
  }>(sql`
    select reads_enabled, writes_enabled
    from private.research_group_runtime_settings
    where singleton
  `);
  const settings = result.rows[0];

  return {
    readsEnabled: settings?.reads_enabled ?? false,
    writesEnabled: settings?.writes_enabled ?? false,
  };
}

async function getActiveRole(actorOwnerId: string, groupId: string) {
  const rows = await db
    .select({
      role: researchGroupMembers.role,
      state: researchGroups.state,
    })
    .from(researchGroups)
    .innerJoin(
      researchGroupMembers,
      and(
        eq(researchGroupMembers.groupId, researchGroups.id),
        eq(researchGroupMembers.memberId, actorOwnerId),
        isNull(researchGroupMembers.revokedAt),
      ),
    )
    .where(eq(researchGroups.id, groupId))
    .limit(1);

  return rows[0]?.state === "active" ? rows[0].role : null;
}

export async function requireResearchGroupPermission(
  actorOwnerId: string,
  groupId: string,
  minimumRole: ResearchGroupRole,
  operation: ResearchGroupOperation,
) {
  requireOwnerId(actorOwnerId, "requireResearchGroupPermission");

  const [settings, actualRole] = await Promise.all([
    getRuntimeSettings(),
    getActiveRole(actorOwnerId, groupId),
  ]);

  return assertResearchGroupPermission({
    actualRole,
    minimumRole,
    operation,
    ...settings,
  });
}

// Lists active memberships only after the global read switch is checked.
/** @user-scoped */
export async function listResearchGroups(
  actorOwnerId: string,
): Promise<ResearchGroupSummary[]> {
  requireOwnerId(actorOwnerId, "listResearchGroups");
  const settings = await getRuntimeSettings();
  if (!settings.readsEnabled) {
    throw new ResearchGroupUnavailableError();
  }

  return db
    .select({
      id: researchGroups.id,
      name: researchGroups.name,
      description: researchGroups.description,
      role: researchGroupMembers.role,
      revision: researchGroups.revision,
      createdAt: researchGroups.createdAt,
      updatedAt: researchGroups.updatedAt,
    })
    .from(researchGroups)
    .innerJoin(
      researchGroupMembers,
      and(
        eq(researchGroupMembers.groupId, researchGroups.id),
        eq(researchGroupMembers.memberId, actorOwnerId),
        isNull(researchGroupMembers.revokedAt),
      ),
    )
    .where(
      and(
        eq(researchGroups.state, "active"),
        sql`exists (
          select 1
          from private.research_group_runtime_settings as settings
          where settings.singleton and settings.reads_enabled
        )`,
      ),
    )
    .orderBy(desc(researchGroups.updatedAt), desc(researchGroups.id));
}

// Creates the group and its sole owner in one transaction.
/** @user-scoped */
export async function createResearchGroup(
  actorOwnerId: string,
  input: { name: string; description?: string | null },
) {
  requireOwnerId(actorOwnerId, "createResearchGroup");
  const settings = await getRuntimeSettings();
  assertResearchGroupPermission({
    actualRole: "owner",
    minimumRole: "owner",
    operation: "write",
    ...settings,
  });

  const name = input.name.trim();
  const description = input.description?.trim() || null;

  if (name.length < 2 || name.length > 80 || (description?.length ?? 0) > 500) {
    throw new Error("Invalid research group metadata.");
  }

  return db.transaction(async (transaction) => {
    const settingsRows = await transaction.execute<{
      reads_enabled: boolean;
      writes_enabled: boolean;
    }>(sql`
      select reads_enabled, writes_enabled
      from private.research_group_runtime_settings
      where singleton
      for share
    `);
    assertResearchGroupPermission({
      actualRole: "owner",
      minimumRole: "owner",
      operation: "write",
      readsEnabled: settingsRows.rows[0]?.reads_enabled ?? false,
      writesEnabled: settingsRows.rows[0]?.writes_enabled ?? false,
    });

    const [group] = await transaction
      .insert(researchGroups)
      .values({ name, description })
      .returning({ id: researchGroups.id });
    await transaction.insert(researchGroupMembers).values({
      groupId: group.id,
      memberId: actorOwnerId,
      role: "owner",
    });
    return group;
  });
}

// Selects or clears the owner's preferred successor.
/** @user-scoped */
export async function selectResearchGroupSuccessor(
  actorOwnerId: string,
  groupId: string,
  successorOwnerId: string | null,
) {
  await requireResearchGroupPermission(
    actorOwnerId,
    groupId,
    "owner",
    "write",
  );

  return db.transaction(async (transaction) => {
    const settingsRows = await transaction.execute<{
      reads_enabled: boolean;
      writes_enabled: boolean;
    }>(sql`
      select reads_enabled, writes_enabled
      from private.research_group_runtime_settings
      where singleton
      for share
    `);
    await transaction.execute(
      sql`select id from research_groups where id = ${groupId}::uuid for update`,
    );
    const ownerRows = await transaction
      .select({ role: researchGroupMembers.role })
      .from(researchGroupMembers)
      .where(
        and(
          eq(researchGroupMembers.groupId, groupId),
          eq(researchGroupMembers.memberId, actorOwnerId),
          eq(researchGroupMembers.role, "owner"),
          isNull(researchGroupMembers.revokedAt),
        ),
      )
      .limit(1);
    assertResearchGroupPermission({
      actualRole: ownerRows[0]?.role ?? null,
      minimumRole: "owner",
      operation: "write",
      readsEnabled: settingsRows.rows[0]?.reads_enabled ?? false,
      writesEnabled: settingsRows.rows[0]?.writes_enabled ?? false,
    });

    if (successorOwnerId !== null) {
      const successor = await transaction
        .select({ role: researchGroupMembers.role })
        .from(researchGroupMembers)
        .where(
          and(
            eq(researchGroupMembers.groupId, groupId),
            eq(researchGroupMembers.memberId, successorOwnerId),
            isNull(researchGroupMembers.revokedAt),
          ),
        )
        .limit(1);

      if (!successor[0] || successor[0].role === "owner") {
        throw new ResearchGroupUnavailableError();
      }
    }

    await transaction
      .update(researchGroups)
      .set({
        selectedSuccessorId: successorOwnerId,
        revision: sql`${researchGroups.revision} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(researchGroups.id, groupId));
  });
}

// Deletes only a dedicated research group. Private playlists are
// a separate domain and are never read or modified.
/** @user-scoped */
export async function deleteResearchGroup(
  actorOwnerId: string,
  groupId: string,
) {
  await requireResearchGroupPermission(
    actorOwnerId,
    groupId,
    "owner",
    "write",
  );
  await db.transaction(async (transaction) => {
    const settingsRows = await transaction.execute<{
      reads_enabled: boolean;
      writes_enabled: boolean;
    }>(sql`
      select reads_enabled, writes_enabled
      from private.research_group_runtime_settings
      where singleton
      for share
    `);
    await transaction.execute(
      sql`select id from research_groups where id = ${groupId}::uuid for update`,
    );
    const ownerRows = await transaction
      .select({ role: researchGroupMembers.role })
      .from(researchGroupMembers)
      .where(
        and(
          eq(researchGroupMembers.groupId, groupId),
          eq(researchGroupMembers.memberId, actorOwnerId),
          eq(researchGroupMembers.role, "owner"),
          isNull(researchGroupMembers.revokedAt),
        ),
      )
      .limit(1);
    assertResearchGroupPermission({
      actualRole: ownerRows[0]?.role ?? null,
      minimumRole: "owner",
      operation: "write",
      readsEnabled: settingsRows.rows[0]?.reads_enabled ?? false,
      writesEnabled: settingsRows.rows[0]?.writes_enabled ?? false,
    });
    await transaction
      .delete(researchGroups)
      .where(eq(researchGroups.id, groupId));
  });
}

// Runs the lower-level deterministic group-domain account-closure routine.
// The Clerk webhook uses an atomic RPC wrapper that also removes the identity.
/** @admin */
export async function handleResearchGroupAccountClosure(ownerId: string) {
  requireOwnerId(ownerId, "handleResearchGroupAccountClosure");
  const result = await db.execute<{
    groups_transferred: number;
    groups_deleted: number;
    memberships_removed: number;
  }>(sql`select * from handle_research_group_account_closure(${ownerId})`);
  return result.rows;
}
