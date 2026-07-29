import "server-only";

type ClerkDeletionRpcClient = {
  rpc(
    functionName: "handle_clerk_user_deleted",
    args: { p_owner_id: string },
  ): PromiseLike<{ error: unknown | null }>;
};

export async function handleDeletedClerkUser(
  ownerId: string,
  client: ClerkDeletionRpcClient,
) {
  try {
    const { error } = await client.rpc("handle_clerk_user_deleted", {
      p_owner_id: ownerId,
    });

    return error
      ? new Response("Identity sync failed", { status: 500 })
      : new Response(null, { status: 204 });
  } catch {
    return new Response("Identity sync failed", { status: 500 });
  }
}
