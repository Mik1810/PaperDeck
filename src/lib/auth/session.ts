import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";

export type AuthenticatedUserContext = {
  ownerId: string;
  displayName: string | null;
  imageUrl: string | null;
};

export async function requireUserContext(): Promise<AuthenticatedUserContext> {
  const authContext = await auth();
  const ownerId = authContext.userId;

  if (!ownerId) {
    authContext.redirectToSignIn();
    throw new Error("Unauthenticated");
  }

  const user = await currentUser();

  return {
    ownerId,
    displayName:
      user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? null,
    imageUrl: user?.imageUrl ?? null,
  };
}
