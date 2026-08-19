import { NextResponse } from "next/server";
import { requireOwnerId } from "@/lib/auth/session";
import { logger } from "@/lib/logging/logger";
import { recordRecommendationImpression } from "@/lib/repositories/user-data";

export async function POST(request: Request) {
  const ownerId = await requireOwnerId();
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const paperId = body.paperId;
  const recommendationBatchItemId = body.recommendationBatchItemId;

  if (
    typeof paperId !== "string" ||
    typeof recommendationBatchItemId !== "string"
  ) {
    return NextResponse.json(
      { ok: false, error: "Missing recommendation batch item" },
      { status: 400 },
    );
  }

  try {
    const recommendationImpressionId = await recordRecommendationImpression(
      ownerId,
      paperId,
      recommendationBatchItemId,
    );

    if (!recommendationImpressionId) {
      return NextResponse.json(
        { ok: false, error: "Invalid recommendation batch item" },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      recommendationImpressionId,
    });
  } catch (error) {
    logger.error("recommendation_impression_record_failed", {
      error,
    });

    return NextResponse.json(
      {
        ok: false,
        error:
          process.env.NODE_ENV === "development"
            ? error instanceof Error
              ? error.message
              : "Unknown error"
            : "Internal error",
      },
      { status: 500 },
    );
  }
}
