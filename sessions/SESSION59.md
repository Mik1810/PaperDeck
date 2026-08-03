# Session 59

## Issue #98: notification center and history

- Agreed to keep durable refetch as the correctness path and use a 60-second
  visible-page poll plus refetch on open, focus, visibility, and reconnect.
  Realtime remains optional.
- Added an authenticated header bell with unread badge capped at `99+`, a
  latest-20 desktop popover/mobile bottom sheet, pinned actionable requests,
  explicit loading/empty/error states, focus trapping, Escape close/focus
  restoration, mobile safe-area padding, and a small dismissible toast for new
  important events after the initial load.
- Added `/notifications` with All/Requests/Groups and All/Unread/Read filters,
  stable cursor pagination, mark-one/mark-all, archive controls, loading and
  error boundaries.
- Added authenticated, private/no-store `/api/notifications`; it returns only
  owner-scoped notification projections and unread count. Concurrent refreshes
  use a sequence guard so stale network responses cannot overwrite newer state.
- Extended notification projections with the authoritative friend-request and
  group-invitation status. Inline actions appear only while that source is
  pending; the existing transactional lifecycle remains the final stale-state
  validator.

## In-app group invitation response

- Found that notification rows intentionally contain no raw invitation token,
  while the existing response RPC requires its digest. The UI therefore could
  not safely implement inline group actions without a backend decision.
- Added migration
  `20260803222656_add_in_app_group_invitation_response.sql`. The new
  service-role-only RPC locks only an invitation whose recipient matches the
  authenticated actor, retrieves the existing digest internally, and delegates
  to the existing token-aware lifecycle.
- The wrapper returns no token/digest and preserves expiry, single-use,
  idempotency, policy, friendship/block, group-state, and read/write kill-switch
  checks. Direct `anon` and `authenticated` execution remains revoked.
- Added repository and Server Action wrappers with generic stale/unavailable
  responses. No migration was applied remotely and no group switch was changed.

## Scope decision

- Deferred per-group `all`/`important_only`/`muted` preferences to #99. Groups
  remain disabled and PaperDeck has no paper-activity events yet, so the setting
  would currently have no non-critical event to filter.

## Validation

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit` (`110/110` passed)
- `npm run audit:service-role`
- `npm run build`
- `npm run test:e2e` (the 76-test desktop/mobile matrix completed with no
  failures; authentication-only smoke cases remained skipped by configuration)
- Playwright read-only verification at `1440x1000` and `390x844`: page and menu
  rendered without console/error overlays; desktop popover and mobile bottom
  sheet stayed inside their viewports; Escape closed the dialog and restored
  focus to the bell.
- The browser used local dev-auth and performed notification reads only. It did
  not invoke Accept, Decline, Archive, or acknowledgement actions.
- Docker returned an immediate local I/O error, so the new migration integration
  case is prepared but has not yet run against an isolated PostgreSQL instance.
  The shared Supabase project was not used for migration or synthetic fixtures.
