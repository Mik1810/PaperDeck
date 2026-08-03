import assert from "node:assert/strict";
import test from "node:test";
import {
  formatNotificationTimestamp,
  isImportantNotification,
  isNotificationActionable,
  pinActionableNotifications,
  presentNotification,
} from "../../src/lib/notifications/presentation";
import type { NotificationSummary } from "../../src/lib/repositories/notifications";

function notification(
  overrides: Partial<NotificationSummary> = {},
): NotificationSummary {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    type: "friend_request_received",
    actor: {
      publicId: "00000000-0000-4000-8000-000000000002",
      displayName: "Ada",
      imageUrl: null,
    },
    friendRequestId: "00000000-0000-4000-8000-000000000003",
    friendRequestStatus: "pending",
    groupInvitationId: null,
    groupInvitationStatus: null,
    group: null,
    readAt: null,
    createdAt: "2026-08-03T22:00:00.000Z",
    expiresAt: "2026-11-01T22:00:00.000Z",
    ...overrides,
  };
}

test("presents source-grounded notification copy without private identifiers", () => {
  assert.deepEqual(presentNotification(notification()), {
    title: "New friend request",
    detail: "Ada wants to connect with you.",
  });
  assert.deepEqual(
    presentNotification(
      notification({
        type: "group_role_changed",
        actor: null,
        friendRequestId: null,
        friendRequestStatus: null,
        group: {
          id: "00000000-0000-4000-8000-000000000004",
          name: "Systems Lab",
        },
      }),
    ),
    {
      title: "Group role changed",
      detail: "Your role in Systems Lab has changed.",
    },
  );
});

test("treats only currently pending received requests as actionable", () => {
  assert.equal(isNotificationActionable(notification()), true);
  assert.equal(
    isNotificationActionable(notification({ friendRequestStatus: "accepted" })),
    false,
  );
  assert.equal(
    isNotificationActionable(
      notification({
        type: "group_invitation_received",
        friendRequestId: null,
        friendRequestStatus: null,
        groupInvitationId: "00000000-0000-4000-8000-000000000005",
        groupInvitationStatus: "pending",
      }),
    ),
    true,
  );
});

test("pins actionable items while preserving newest-first order within groups", () => {
  const passive = notification({
    id: "00000000-0000-4000-8000-000000000010",
    type: "friendship_accepted",
    friendRequestStatus: "accepted",
    createdAt: "2026-08-03T23:00:00.000Z",
  });
  const actionable = notification({
    id: "00000000-0000-4000-8000-000000000011",
    createdAt: "2026-08-03T22:00:00.000Z",
  });

  assert.deepEqual(
    pinActionableNotifications([passive, actionable]).map((item) => item.id),
    [actionable.id, passive.id],
  );
});

test("limits silent toast candidates and formats deterministic UTC timestamps", () => {
  assert.equal(isImportantNotification(notification()), true);
  assert.equal(
    isImportantNotification(notification({ type: "group_member_joined" })),
    false,
  );
  assert.equal(
    formatNotificationTimestamp("2026-08-03T22:00:00.000Z"),
    "Aug 3, 2026, 10:00 PM",
  );
});
