import type { NotificationSummary } from "@/lib/repositories/notifications";

export type NotificationPresentation = {
  title: string;
  detail: string;
};

function actorName(notification: NotificationSummary) {
  return notification.actor?.displayName?.trim() || "Someone";
}

function groupName(notification: NotificationSummary) {
  return notification.group?.name?.trim() || "a research group";
}

export function presentNotification(
  notification: NotificationSummary,
): NotificationPresentation {
  const actor = actorName(notification);
  const group = groupName(notification);

  switch (notification.type) {
    case "friend_request_received":
      return {
        title: "New friend request",
        detail: `${actor} wants to connect with you.`,
      };
    case "friendship_accepted":
      return {
        title: "Friend request accepted",
        detail: `${actor} is now one of your connections.`,
      };
    case "group_invitation_received":
      return {
        title: "Research group invitation",
        detail: `${actor} invited you to ${group}.`,
      };
    case "group_invitation_accepted":
      return {
        title: "Group invitation accepted",
        detail: `${actor} joined ${group}.`,
      };
    case "group_member_joined":
      return {
        title: "New group member",
        detail: `${actor} joined ${group}.`,
      };
    case "group_membership_ended":
      return {
        title: "Group membership ended",
        detail: `Your membership in ${group} has ended.`,
      };
    case "group_role_changed":
      return {
        title: "Group role changed",
        detail: `Your role in ${group} has changed.`,
      };
    case "group_ownership_transferred":
      return {
        title: "Group ownership transferred",
        detail: `You are now the owner of ${group}.`,
      };
  }
}

export function isNotificationActionable(notification: NotificationSummary) {
  return (
    (notification.type === "friend_request_received" &&
      notification.friendRequestStatus === "pending") ||
    (notification.type === "group_invitation_received" &&
      notification.groupInvitationStatus === "pending")
  );
}

export function isImportantNotification(notification: NotificationSummary) {
  return ![
    "group_invitation_accepted",
    "group_member_joined",
  ].includes(notification.type);
}

export function pinActionableNotifications(items: NotificationSummary[]) {
  return [...items].sort((left, right) => {
    const actionableDifference =
      Number(isNotificationActionable(right)) -
      Number(isNotificationActionable(left));
    if (actionableDifference !== 0) return actionableDifference;
    return (
      Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
      right.id.localeCompare(left.id)
    );
  });
}

export function formatNotificationTimestamp(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}
