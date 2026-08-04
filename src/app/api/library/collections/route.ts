import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { requireOwnerId } from "@/lib/auth/session";
import { getLibraryBackgroundData } from "@/lib/repositories/user-data";
import { privateNoStoreHeaders } from "@/lib/security/route-cache-policy";

export const dynamic = "force-dynamic";

function responseHeaders() {
  return Object.fromEntries(
    privateNoStoreHeaders().map((header) => [header.key, header.value]),
  );
}

export async function GET() {
  try {
    const ownerId = await requireOwnerId();
    const data = await getLibraryBackgroundData(ownerId);
    return NextResponse.json(data, { headers: responseHeaders() });
  } catch (error) {
    unstable_rethrow(error);
    return NextResponse.json(
      { error: "Library collections are unavailable." },
      { status: 500, headers: responseHeaders() },
    );
  }
}
