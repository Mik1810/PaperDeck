# Session 30 — Research groups and notification decisions

## Decisions

- The collaboration target is private, small research groups.
- Each group has one shared paper list and owner/admin/member roles; only owner
  and admin can invite, and every invite requires explicit acceptance.
- Exact-email account discovery is enabled by default and can be disabled in
  Settings. No partial search, autocomplete, or public directory is planned.
- Friendships are mutual after acceptance. Declined requests have a 30-day
  cooldown; blocks prevent further requests and invitations.
- Ownership moves to an explicitly selected successor, otherwise the oldest
  active admin, then the oldest active member. A group with no successor is
  deleted.
- The notification bell uses a `99+` badge and a 20-item menu with inline
  Accept/Decline actions; a complete history page remains planned.
- Notifications persist for 90 days in Postgres. Private realtime events only
  signal clients to refetch authorized state.
- Group membership, role/ownership, friendship, invitation, and shared-paper
  changes generate notifications.
- Interactive group chat, potentially contextual to shared papers, is recorded
  as a separate design topic and is not authorized for implementation yet.

## Documentation

- Updated `ROADMAP.md`, `docs/social-interactions-plan.md`, and `CHANGELOG.md`.

## Implementation

- Planning only. No schema, application code, dependency, or GitHub issue was
  created or changed.
