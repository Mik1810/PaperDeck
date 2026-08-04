"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, Check, Users } from "lucide-react";
import {
  archiveNotificationAction,
  markNotificationReadAction,
  respondNotificationFriendRequestAction,
  respondNotificationGroupInvitationAction,
  type NotificationActionResult,
} from "@/app/actions";
import { MutationAlert } from "@/components/mutation-alert";
import {
  formatNotificationTimestamp,
  isNotificationActionable,
  presentNotification,
} from "@/lib/notifications/presentation";
import type { NotificationSummary } from "@/lib/repositories/notifications";

type NotificationListProps = {
  initialItems: NotificationSummary[];
  compact?: boolean;
  onChanged?: () => void;
};

export function NotificationList({
  initialItems,
  compact = false,
  onChanged,
}: NotificationListProps) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(
    notification: NotificationSummary,
    action: () => Promise<NotificationActionResult>,
    update: (item: NotificationSummary) => NotificationSummary | null,
  ) {
    setErrorMessage(null);
    setPendingId(notification.id);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setErrorMessage(
            result.message || "The notification could not be updated.",
          );
          return;
        }
        setItems((current) =>
          current.flatMap((item) => {
            if (item.id !== notification.id) return [item];
            const next = update(item);
            return next ? [next] : [];
          }),
        );
        router.refresh();
        onChanged?.();
      } catch {
        setErrorMessage("The notification could not be updated. Try again.");
      } finally {
        setPendingId(null);
      }
    });
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
        <p className="text-sm font-bold text-slate-700">No notifications here</p>
        <p className="mt-1 text-sm text-slate-500">
          New requests and group updates will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <MutationAlert message={errorMessage} />
      <ul className={compact ? "divide-y divide-slate-200" : "space-y-3"}>
        {items.map((notification) => {
          const presentation = presentNotification(notification);
          const actionable = isNotificationActionable(notification);
          const itemPending = isPending && pendingId === notification.id;
          return (
            <li
              key={notification.id}
              className={`relative ${
                compact
                  ? "py-4 first:pt-0 last:pb-0"
                  : "rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              } ${notification.readAt ? "" : "border-l-4 border-l-teal-500"}`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${
                    actionable
                      ? "bg-teal-100 text-teal-800"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  <Users aria-hidden="true" size={17} strokeWidth={2.4} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-slate-950">
                        {presentation.title}
                      </p>
                      <p className="mt-1 text-sm leading-5 text-slate-600">
                        {presentation.detail}
                      </p>
                    </div>
                    {!notification.readAt ? (
                      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-teal-500">
                        <span className="sr-only">Unread</span>
                      </span>
                    ) : null}
                  </div>
                  <time
                    className="mt-2 block text-xs font-semibold text-slate-400"
                    dateTime={notification.createdAt}
                  >
                    {formatNotificationTimestamp(notification.createdAt)} UTC
                  </time>

                  {actionable ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={itemPending}
                        onClick={() => {
                          const now = new Date().toISOString();
                          if (
                            notification.type === "friend_request_received" &&
                            notification.friendRequestId
                          ) {
                            run(
                              notification,
                              () =>
                                respondNotificationFriendRequestAction(
                                  notification.id,
                                  notification.friendRequestId!,
                                  true,
                                ),
                              (item) => ({
                                ...item,
                                readAt: item.readAt ?? now,
                                friendRequestStatus: "accepted",
                              }),
                            );
                          } else if (
                            notification.type === "group_invitation_received" &&
                            notification.groupInvitationId
                          ) {
                            run(
                              notification,
                              () =>
                                respondNotificationGroupInvitationAction(
                                  notification.id,
                                  notification.groupInvitationId!,
                                  true,
                                ),
                              (item) => ({
                                ...item,
                                readAt: item.readAt ?? now,
                                groupInvitationStatus: "accepted",
                              }),
                            );
                          }
                        }}
                        className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={itemPending}
                        onClick={() => {
                          const now = new Date().toISOString();
                          if (
                            notification.type === "friend_request_received" &&
                            notification.friendRequestId
                          ) {
                            run(
                              notification,
                              () =>
                                respondNotificationFriendRequestAction(
                                  notification.id,
                                  notification.friendRequestId!,
                                  false,
                                ),
                              (item) => ({
                                ...item,
                                readAt: item.readAt ?? now,
                                friendRequestStatus: "declined",
                              }),
                            );
                          } else if (
                            notification.type === "group_invitation_received" &&
                            notification.groupInvitationId
                          ) {
                            run(
                              notification,
                              () =>
                                respondNotificationGroupInvitationAction(
                                  notification.id,
                                  notification.groupInvitationId!,
                                  false,
                                ),
                              (item) => ({
                                ...item,
                                readAt: item.readAt ?? now,
                                groupInvitationStatus: "declined",
                              }),
                            );
                          }
                        }}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                      >
                        Decline
                      </button>
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-3 text-xs font-bold">
                    {!notification.readAt ? (
                      <button
                        type="button"
                        disabled={itemPending}
                        onClick={() => {
                          const now = new Date().toISOString();
                          run(
                            notification,
                            () => markNotificationReadAction(notification.id),
                            (item) => ({ ...item, readAt: now }),
                          );
                        }}
                        className="inline-flex items-center gap-1 text-teal-700 hover:text-teal-900 disabled:opacity-60"
                      >
                        <Check aria-hidden="true" size={14} /> Mark as read
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={itemPending}
                      onClick={() =>
                        run(
                          notification,
                          () => archiveNotificationAction(notification.id),
                          () => null,
                        )
                      }
                      className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900 disabled:opacity-60"
                    >
                      <Archive aria-hidden="true" size={14} /> Archive
                    </button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
