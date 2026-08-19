import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import { getDevOwnerId, isDevAuthEnabled } from "@/lib/auth/dev-auth";

export type AuthenticatedUserContext = {
  ownerId: string;
  displayName: string | null;
  imageUrl: string | null;
  primaryEmail: string | null;
  sourceUpdatedAt: number;
};

export async function requireOwnerId() {
  if (isDevAuthEnabled()) {
    return getDevOwnerId();
  }

  const authContext = await auth();
  const ownerId = authContext.userId;

  if (!ownerId) {
    authContext.redirectToSignIn();
    throw new Error("Unauthenticated");
  }

  return ownerId;
}

export async function requireUserContext(): Promise<AuthenticatedUserContext> {
  if (isDevAuthEnabled()) {
    return {
      ownerId: getDevOwnerId(),
      displayName: "Local dev",
      imageUrl: null,
      primaryEmail: null,
      sourceUpdatedAt: 0,
    };
  }

  const authContext = await auth();
  const ownerId = authContext.userId;

  if (!ownerId) {
    authContext.redirectToSignIn();
    throw new Error("Unauthenticated");
  }

  const user = await currentUser();
  const primaryEmail = user?.primaryEmailAddress;

  return {
    ownerId,
    displayName: user?.fullName ?? null,
    imageUrl: user?.imageUrl ?? null,
    sourceUpdatedAt: user?.updatedAt ?? 0,
    primaryEmail:
      primaryEmail?.verification?.status === "verified"
        ? primaryEmail.emailAddress
        : null,
  };
}
