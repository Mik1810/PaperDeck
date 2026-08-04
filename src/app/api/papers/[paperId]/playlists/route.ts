import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { requireOwnerId } from "@/lib/auth/session";
import { getPaperPlaylistOptions } from "@/lib/repositories/user-data";
import { privateNoStoreHeaders } from "@/lib/security/route-cache-policy";

export const dynamic = "force-dynamic";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function responseHeaders() {
  return Object.fromEntries(
    privateNoStoreHeaders().map((header) => [header.key, header.value]),
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ paperId: string }> },
) {
  try {
    const ownerId = await requireOwnerId();
    const { paperId } = await params;
    if (!uuidPattern.test(paperId)) {
      return NextResponse.json(
        { error: "Invalid paper id." },
        { status: 400, headers: responseHeaders() },
      );
    }

    const items = await getPaperPlaylistOptions(ownerId, paperId);
    return NextResponse.json({ items }, { headers: responseHeaders() });
  } catch (error) {
    unstable_rethrow(error);
    return NextResponse.json(
      { error: "Playlists are unavailable." },
      { status: 500, headers: responseHeaders() },
    );
  }
}
