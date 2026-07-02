import { NextRequest, NextResponse } from "next/server";
import { requireOwnerId } from "@/lib/auth/session";
import { recordPaperInteraction } from "@/lib/repositories/user-data";

const detailFeedbackActions = ["already_read", "not_interested"] as const;

type DetailFeedbackAction = (typeof detailFeedbackActions)[number];

function isDetailFeedbackAction(
  action: FormDataEntryValue | null,
): action is DetailFeedbackAction {
  return detailFeedbackActions.some((validAction) => validAction === action);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paperId: string }> },
) {
  const { paperId } = await params;
  const formData = await request.formData();
  const action = formData.get("action");

  if (!isDetailFeedbackAction(action)) {
    return NextResponse.redirect(new URL(`/papers/${paperId}`, request.url), {
      status: 303,
    });
  }

  const ownerId = await requireOwnerId();
  await recordPaperInteraction(ownerId, paperId, action, "detail");

  return NextResponse.redirect(new URL("/feed", request.url), { status: 303 });
}
