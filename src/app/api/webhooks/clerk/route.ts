import "server-only";

import { verifyWebhook } from "@clerk/backend/webhooks";
import { emailLookupHash } from "@/lib/collaboration/email-lookup";
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
    const { error } = await supabase
      .from("collaboration_identities")
      .delete()
      .eq("owner_id", ownerId);

    return error
      ? new Response("Identity sync failed", { status: 500 })
      : new Response(null, { status: 204 });
  }

  const primaryEmail = event.data.email_addresses.find(
    (email) =>
      email.id === event.data.primary_email_address_id &&
      email.verification?.status === "verified",
  );
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (profileError) {
    return new Response("Profile sync failed", { status: 500 });
  }

  const hasSafePublicName =
    profile?.display_name &&
    !profile.display_name.includes("@") &&
    [...profile.display_name.trim()].length >= 2 &&
    [...profile.display_name.trim()].length <= 50;

  if (!primaryEmail || !hasSafePublicName) {
    const { error } = await supabase
      .from("collaboration_identities")
      .delete()
      .eq("owner_id", ownerId);

    return error
      ? new Response("Identity sync failed", { status: 500 })
      : new Response(null, { status: 204 });
  }

  const { error } = await supabase.from("collaboration_identities").upsert(
    {
      owner_id: ownerId,
      email_lookup_hash: emailLookupHash(primaryEmail.email_address),
      email_hash_version: 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id" },
  );

  return error
    ? new Response("Identity sync failed", { status: 500 })
    : new Response(null, { status: 204 });
}
