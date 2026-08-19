import "server-only";

import { emailLookupHash } from "@/lib/collaboration/email-lookup";
import type { GroupInvitePolicy } from "@/lib/collaboration/profile";

type ClerkIdentityUser = {
  primary_email_address_id: string | null;
  email_addresses: Array<{
    id: string;
    email_address: string;
    verification?: { status?: string | null } | null;
  }>;
};

export function deriveClerkIdentityEmailLookupHash(
  user: ClerkIdentityUser,
  displayName: string | null | undefined,
) {
  const primaryEmail = user.email_addresses.find(
    (email) =>
      email.id === user.primary_email_address_id &&
      email.verification?.status === "verified",
  );
  const trimmedName = displayName?.trim();
  const hasSafePublicName =
    Boolean(trimmedName) &&
    !trimmedName?.includes("@") &&
    [...(trimmedName ?? "")].length >= 2 &&
    [...(trimmedName ?? "")].length <= 50;

  return primaryEmail && hasSafePublicName
    ? emailLookupHash(primaryEmail.email_address)
    : null;
}

type ClerkIdentitySyncClient = {
  rpc(
    functionName: "sync_clerk_collaboration_identity",
    args: {
      p_owner_id: string;
      p_source_updated_at: number;
      p_email_lookup_hash: string | null;
      p_email_hash_version: number;
      p_discoverable_by_email: boolean | null;
      p_group_invite_policy: GroupInvitePolicy | null;
      p_allow_same_source_version: boolean;
    },
  ): PromiseLike<{ error: unknown | null }>;
};

export type ClerkIdentitySyncInput = {
  ownerId: string;
  sourceUpdatedAt: number;
  emailLookupHash: string | null;
  discoverableByEmail?: boolean;
  groupInvitePolicy?: GroupInvitePolicy;
  allowSameSourceVersion?: boolean;
};

export async function syncClerkCollaborationIdentity(
  input: ClerkIdentitySyncInput,
  client: ClerkIdentitySyncClient,
) {
  try {
    return await client.rpc("sync_clerk_collaboration_identity", {
      p_owner_id: input.ownerId,
      p_source_updated_at: input.sourceUpdatedAt,
      p_email_lookup_hash: input.emailLookupHash,
      p_email_hash_version: 1,
      p_discoverable_by_email: input.discoverableByEmail ?? null,
      p_group_invite_policy: input.groupInvitePolicy ?? null,
      p_allow_same_source_version: input.allowSameSourceVersion ?? false,
    });
  } catch (error) {
    return { error };
  }
}

export async function handleUpdatedClerkUser(
  input: ClerkIdentitySyncInput,
  client: ClerkIdentitySyncClient,
) {
  const { error } = await syncClerkCollaborationIdentity(input, client);

  return error
    ? new Response("Identity sync failed", { status: 500 })
    : new Response(null, { status: 204 });
}
