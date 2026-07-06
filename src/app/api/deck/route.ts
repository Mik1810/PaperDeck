import { NextResponse } from "next/server";
import { after } from "next/server";
import { requireOwnerId } from "@/lib/auth/session";
import {
  recordPaperInteraction,
  resolveRecommendationImpressionId,
  toggleFavorite,
  toggleReadLater,
} from "@/lib/repositories/user-data";
import { refreshUserProfileEmbedding } from "@/lib/repositories/user-profile-embeddings";
import { logger } from "@/lib/logging/logger";

export async function POST(request: Request) {
  const ownerId = await requireOwnerId();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action;
  const paperId = body.paperId;
  const recommendationImpressionId =
    typeof body.recommendationImpressionId === "string"
      ? body.recommendationImpressionId
      : null;

  if (!paperId || typeof paperId !== "string") {
    return NextResponse.json({ ok: false, error: "Missing paperId" }, { status: 400 });
  }

  try {
    let response: NextResponse;
    const resolvedRecommendationImpressionId =
      await resolveRecommendationImpressionId(
        ownerId,
        paperId,
        recommendationImpressionId,
      );
    const interactionOptions = {
      recommendationImpressionId: resolvedRecommendationImpressionId,
    };

    switch (action) {
      case "favorite": {
        await toggleFavorite(ownerId, paperId, interactionOptions);
        response = NextResponse.json({ ok: true, action: "favorite" });
        break;
      }
      case "read_later": {
        await toggleReadLater(ownerId, paperId, interactionOptions);
        response = NextResponse.json({ ok: true, action: "read_later" });
        break;
      }
      case "dismiss": {
        await recordPaperInteraction(
          ownerId,
          paperId,
          "dismiss",
          "feed",
          interactionOptions,
        );
        response = NextResponse.json({ ok: true, action: "dismiss" });
        break;
      }
      case "open_detail": {
        await recordPaperInteraction(
          ownerId,
          paperId,
          "open_detail",
          "feed",
          interactionOptions,
        );
        response = NextResponse.json({ ok: true, action: "open_detail" });
        break;
      }
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
    }

    after(async () => {
      try {
        await refreshUserProfileEmbedding(ownerId);
      } catch (error) {
        logger.error("deck_profile_refresh_failed", { ownerId, error });
      }
    });

    return response;
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
