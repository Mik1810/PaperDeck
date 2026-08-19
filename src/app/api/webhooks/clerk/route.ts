import "server-only";

import { handleDeletedClerkUser } from "@/lib/clerk/user-deletion";
import {
  deriveClerkIdentityEmailLookupHash,
  handleUpdatedClerkUser,
} from "@/lib/clerk/user-identity-sync";
import { verifyWebhook } from "@/lib/clerk/webhook-verification";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let event: Awaited<ReturnType<typeof verifyWebhook>>;

  try {
    event = await verifyWebhook(request);
  } catch {
    return new Response("Invalid webhook signature", { status: 400 });
  }

  if (
    event.type !== "user.created" &&
    event.type !== "user.updated" &&
    event.type !== "user.deleted"
  ) {
    return new Response(null, { status: 204 });
  }

  const ownerId = event.data.id;
  if (!ownerId) {
    return new Response(null, { status: 204 });
  }

  const supabase = createServiceRoleClient();

  if (event.type === "user.deleted") {
    return handleDeletedClerkUser(ownerId, supabase);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (profileError) {
    return new Response("Profile sync failed", { status: 500 });
  }

  return handleUpdatedClerkUser(
    {
      ownerId,
      sourceUpdatedAt: event.data.updated_at,
      emailLookupHash: deriveClerkIdentityEmailLookupHash(
        event.data,
        profile?.display_name,
      ),
    },
    supabase,
  );
}
