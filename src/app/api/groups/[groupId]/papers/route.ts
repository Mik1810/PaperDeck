import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { requireOwnerId } from "@/lib/auth/session";
import { ResearchGroupUnavailableError } from "@/lib/research-groups/permissions";
import { InvalidResearchGroupPaperCursorError } from "@/lib/repositories/research-group-cursor";
import { loadResearchGroupPaperPage } from "@/lib/repositories/research-group-workspace";
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
  request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  try {
    const ownerId = await requireOwnerId();
    const { groupId } = await params;
    const cursor = new URL(request.url).searchParams.get("cursor") ?? "";

    if (!uuidPattern.test(groupId) || !cursor) {
      return NextResponse.json(
        { error: "A valid group and pagination cursor are required." },
        { status: 400, headers: responseHeaders() },
      );
    }

    const page = await loadResearchGroupPaperPage(ownerId, groupId, cursor);
    return NextResponse.json(page, { headers: responseHeaders() });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof InvalidResearchGroupPaperCursorError) {
      return NextResponse.json(
        { error: "The research-group pagination cursor is invalid." },
        { status: 400, headers: responseHeaders() },
      );
    }
    if (error instanceof ResearchGroupUnavailableError) {
      return NextResponse.json(
        { error: "Research group unavailable." },
        { status: 404, headers: responseHeaders() },
      );
    }
    return NextResponse.json(
      { error: "Research-group papers are unavailable." },
      { status: 500, headers: responseHeaders() },
    );
  }
}
