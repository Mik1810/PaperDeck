import { NextResponse } from "next/server";
import { requireOwnerId } from "@/lib/auth/session";
import {
  recordPaperInteraction,
  toggleFavorite,
  toggleReadLater,
} from "@/lib/repositories/user-data";
import { logger } from "@/lib/logging/logger";

export async function POST(request: Request) {
  const ownerId = await requireOwnerId();
  const body = (await request.json().catch(() => ({}))) as Record<string, string>;
  const action = body.action;
  const paperId = body.paperId;

  if (!paperId || typeof paperId !== "string") {
    return NextResponse.json({ ok: false, error: "Missing paperId" }, { status: 400 });
  }

  try {
    switch (action) {
      case "favorite": {
        await toggleFavorite(ownerId, paperId);
        return NextResponse.json({ ok: true, action: "favorite" });
      }
      case "read_later": {
        await toggleReadLater(ownerId, paperId);
        return NextResponse.json({ ok: true, action: "read_later" });
      }
      case "dismiss": {
        await recordPaperInteraction(ownerId, paperId, "dismiss");
        return NextResponse.json({ ok: true, action: "dismiss" });
      }
      case "open_detail": {
        await recordPaperInteraction(ownerId, paperId, "open_detail");
        return NextResponse.json({ ok: true, action: "open_detail" });
      }
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    logger.error("deck_action_failed", {
      ownerId,
      action,
      paperId,
      error,
    });

    return NextResponse.json(
      { ok: false, error: process.env.NODE_ENV === "development" ? (error instanceof Error ? error.message : "Unknown error") : "Internal error" },
      { status: 500 },
    );
  }
}
