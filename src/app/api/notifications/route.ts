import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { requireOwnerId } from "@/lib/auth/session";
import {
  countUnreadNotifications,
  listNotifications,
  type NotificationCategory,
  type NotificationCursor,
  type NotificationReadState,
} from "@/lib/repositories/notifications";
import { privateNoStoreHeaders } from "@/lib/security/route-cache-policy";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function responseHeaders() {
  return Object.fromEntries(
    privateNoStoreHeaders().map((header) => [header.key, header.value]),
  );
}

function parseCategory(value: string | null): NotificationCategory {
  return value === "requests" || value === "groups" ? value : "all";
}

function parseReadState(value: string | null): NotificationReadState {
  return value === "read" || value === "unread" ? value : "all";
}

function parseLimit(value: string | null) {
  if (value === null) return 20;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Invalid notification limit.");
  }
  return limit;
}

function parseCursor(url: URL): NotificationCursor | undefined {
  const createdAt = url.searchParams.get("beforeCreatedAt");
  const id = url.searchParams.get("beforeId");
  if (createdAt === null && id === null) return undefined;
  if (
    createdAt === null ||
    id === null ||
    !Number.isFinite(Date.parse(createdAt)) ||
    !UUID_PATTERN.test(id)
  ) {
    throw new Error("Invalid notification cursor.");
  }
  return { createdAt: new Date(createdAt).toISOString(), id };
}

export async function GET(request: Request) {
  try {
    const ownerId = await requireOwnerId();
    const url = new URL(request.url);
    const [items, unreadCount] = await Promise.all([
      listNotifications(ownerId, {
        limit: parseLimit(url.searchParams.get("limit")),
        before: parseCursor(url),
        category: parseCategory(url.searchParams.get("category")),
        readState: parseReadState(url.searchParams.get("readState")),
      }),
      countUnreadNotifications(ownerId),
    ]);

    return NextResponse.json(
      { items, unreadCount },
      { headers: responseHeaders() },
    );
  } catch (error) {
    unstable_rethrow(error);
    const invalidRequest =
      error instanceof Error && error.message.startsWith("Invalid notification");
    return NextResponse.json(
      { error: invalidRequest ? error.message : "Notifications are unavailable." },
      { status: invalidRequest ? 400 : 500, headers: responseHeaders() },
    );
  }
}
