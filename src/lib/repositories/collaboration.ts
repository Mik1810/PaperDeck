import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { collaborationIdentities, profiles } from "@/db/schema";
import type { AuthenticatedUserContext } from "@/lib/auth/session";
import { syncClerkCollaborationIdentity } from "@/lib/clerk/user-identity-sync";
import { isDevAuthEnabled } from "@/lib/auth/dev-auth";
import { emailLookupHash } from "@/lib/collaboration/email-lookup";
import {
  type GroupInvitePolicy,
  validatePublicDisplayName,
} from "@/lib/collaboration/profile";
import {
  createClerkAuthenticatedClient,
  createServiceRoleClient,
} from "@/lib/supabase/server";

export type CollaborationSettings = {
  displayName: string;
  discoverableByEmail: boolean;
  groupInvitePolicy: GroupInvitePolicy;
  hasIdentity: boolean;
};

export type RelationshipStatus =
  | "none"
  | "incoming_pending"
  | "outgoing_pending"
  | "friends"
  | "blocked";

export type CollaborationConnection = {
  publicId: string;
  displayName: string;
  imageUrl: string | null;
  relationshipStatus: Exclude<RelationshipStatus, "none">;
  requestId: string | null;
  occurredAt: string;
};

export async function getCollaborationSettings(
  ownerId: string,
): Promise<CollaborationSettings> {
  const rows = await db
    .select({
      displayName: profiles.displayName,
      discoverableByEmail: collaborationIdentities.discoverableByEmail,
      groupInvitePolicy: collaborationIdentities.groupInvitePolicy,
      collaborationOwnerId: collaborationIdentities.ownerId,
    })
    .from(profiles)
    .leftJoin(
      collaborationIdentities,
      eq(collaborationIdentities.ownerId, profiles.ownerId),
    )
    .where(eq(profiles.ownerId, ownerId))
    .limit(1);

  return {
    displayName: rows[0]?.displayName ?? "",
    discoverableByEmail: rows[0]?.discoverableByEmail ?? false,
    groupInvitePolicy: rows[0]?.groupInvitePolicy ?? "friends_only",
    hasIdentity: Boolean(rows[0]?.collaborationOwnerId),
  };
}

export async function savePublicDisplayName(ownerId: string, value: string) {
  const displayName = validatePublicDisplayName(value);

  await db
    .update(profiles)
    .set({ displayName, updatedAt: new Date().toISOString() })
    .where(eq(profiles.ownerId, ownerId));

  return displayName;
}

export async function syncCollaborationIdentity(
  user: AuthenticatedUserContext,
  preferences?: {
    discoverableByEmail: boolean;
    groupInvitePolicy: GroupInvitePolicy;
  },
) {
  if (isDevAuthEnabled()) {
    return;
  }

  const supabase = createServiceRoleClient();
  const { error } = await syncClerkCollaborationIdentity(
    {
      ownerId: user.ownerId,
      sourceUpdatedAt: user.sourceUpdatedAt,
      emailLookupHash: user.primaryEmail
        ? emailLookupHash(user.primaryEmail)
        : null,
      discoverableByEmail: preferences?.discoverableByEmail,
      groupInvitePolicy: preferences?.groupInvitePolicy,
      allowSameSourceVersion: true,
    },
    supabase,
  );

  if (error) {
    throw new Error("Could not sync collaboration identity");
  }
}

export async function getCollaborationConnections(): Promise<
  CollaborationConnection[]
> {
  if (isDevAuthEnabled()) {
    return [];
  }

  const supabase = await createClerkAuthenticatedClient();
  const { data, error } = await supabase.rpc("list_collaboration_connections");

  if (error) {
    throw new Error(`Could not load connections: ${error.message}`);
  }

  return (data ?? []).flatMap((row: Record<string, unknown>) => {
    const relationshipStatus = row.relationship_status;
    if (
      typeof row.public_id !== "string" ||
      typeof row.display_name !== "string" ||
      typeof row.occurred_at !== "string" ||
      (relationshipStatus !== "incoming_pending" &&
        relationshipStatus !== "outgoing_pending" &&
        relationshipStatus !== "friends" &&
        relationshipStatus !== "blocked")
    ) {
      return [];
    }

    return [{
      publicId: row.public_id,
      displayName: validatePublicDisplayName(row.display_name),
      imageUrl: typeof row.image_url === "string" ? row.image_url : null,
      relationshipStatus,
      requestId: typeof row.request_id === "string" ? row.request_id : null,
      occurredAt: row.occurred_at,
    }];
  });
}
