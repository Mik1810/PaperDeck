import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { NotificationHistoryControls } from "@/components/notification-history-controls";
import { NotificationList } from "@/components/notification-list";
import { requireOwnerId } from "@/lib/auth/session";
import {
  countUnreadNotifications,
  listNotifications,
  type NotificationCategory,
  type NotificationCursor,
  type NotificationReadState,
} from "@/lib/repositories/notifications";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function categoryFrom(value: string | undefined): NotificationCategory {
  return value === "requests" || value === "groups" ? value : "all";
}

function readStateFrom(value: string | undefined): NotificationReadState {
  return value === "read" || value === "unread" ? value : "all";
}

function cursorFrom(
  createdAt: string | undefined,
  id: string | undefined,
): NotificationCursor | undefined {
  if (
    !createdAt ||
    !id ||
    !Number.isFinite(Date.parse(createdAt)) ||
    !UUID_PATTERN.test(id)
  ) {
    return undefined;
  }
  return { createdAt: new Date(createdAt).toISOString(), id };
}

function filterHref(
  category: NotificationCategory,
  readState: NotificationReadState,
) {
  const parameters = new URLSearchParams();
  if (category !== "all") parameters.set("category", category);
  if (readState !== "all") parameters.set("read", readState);
  const query = parameters.toString();
  return query ? `/notifications?${query}` : "/notifications";
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const ownerId = await requireOwnerId();
  const parameters = await searchParams;
  const category = categoryFrom(first(parameters.category));
  const readState = readStateFrom(first(parameters.read));
  const cursor = cursorFrom(
    first(parameters.beforeCreatedAt),
    first(parameters.beforeId),
  );
  const [page, unreadCount] = await Promise.all([
    listNotifications(ownerId, {
      limit: 21,
      before: cursor,
      category,
      readState,
    }),
    countUnreadNotifications(ownerId),
  ]);
  const items = page.slice(0, 20);
  const nextCursor = page.length > 20 ? items.at(-1) : undefined;

  return (
    <AppShell
      title="Notifications"
      subtitle="Requests and research-group updates from the last 90 days."
      action={<NotificationHistoryControls unreadCount={unreadCount} />}
    >
      <div className="space-y-5">
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
          <div className="flex min-w-max items-center justify-between gap-4">
            <nav aria-label="Notification category" className="flex gap-1">
              {(["all", "requests", "groups"] as const).map((value) => (
                <Link
                  key={value}
                  href={filterHref(value, readState)}
                  aria-current={category === value ? "page" : undefined}
                  className={`rounded-lg px-3 py-2 text-sm font-black capitalize ${
                    category === value
                      ? "bg-slate-950 text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {value}
                </Link>
              ))}
            </nav>
            <nav aria-label="Read status" className="flex gap-1">
              {(["all", "unread", "read"] as const).map((value) => (
                <Link
                  key={value}
                  href={filterHref(category, value)}
                  aria-current={readState === value ? "page" : undefined}
                  className={`rounded-lg px-3 py-2 text-sm font-black capitalize ${
                    readState === value
                      ? "bg-teal-100 text-teal-900"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {value}
                </Link>
              ))}
            </nav>
          </div>
        </div>

        <NotificationList
          key={items.map((item) => `${item.id}:${item.readAt}`).join("|")}
          initialItems={items}
        />

        <nav aria-label="Notification history pages" className="flex justify-between">
          {cursor ? (
            <Link
              href={filterHref(category, readState)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50"
            >
              Newest
            </Link>
          ) : (
            <span />
          )}
          {nextCursor ? (
            <Link
              href={`${filterHref(category, readState)}${
                filterHref(category, readState).includes("?") ? "&" : "?"
              }beforeCreatedAt=${encodeURIComponent(nextCursor.createdAt)}&beforeId=${nextCursor.id}`}
              className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white hover:bg-slate-800"
            >
              Older notifications
            </Link>
          ) : null}
        </nav>
      </div>
    </AppShell>
  );
}
