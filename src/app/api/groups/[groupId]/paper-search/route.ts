import { NextResponse } from "next/server";
import { requireOwnerId } from "@/lib/auth/session";
import { searchPapers } from "@/lib/repositories/catalog";
import { requireResearchGroupPermission } from "@/lib/repositories/research-groups";

export const dynamic = "force-dynamic";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const ownerId = await requireOwnerId();
  const { groupId } = await params;
  const query = new URL(request.url).searchParams
    .get("q")
    ?.trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);

  if (!uuidPattern.test(groupId) || !query) {
    return NextResponse.json({ items: [] }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  try {
    await requireResearchGroupPermission(ownerId, groupId, "member", "read");
    const { results } = await searchPapers(query, 1);
    return NextResponse.json(
      { items: results },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Research group unavailable." },
      {
        status: 404,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
