# Session 80

## Issue #173: notification polling and lazy panel loading

### Scope and decisions

- Kept the authenticated, private/no-store notification API and the paginated
  `/notifications` history route intact.
- Split the header-bell contract by request view: a closed bell requests only
  the unread count, while opening the panel requests the latest 20 items plus
  the count.
- Preserved durable polling/refetch as the correctness path. Focus, visibility,
  reconnect, and visible-page polling now share a debounced lifecycle refresh
  with a short duplicate-suppression window.
- Replaced the sequence-only stale-response guard with one active request per
  notification center. Equivalent requests share the same promise; switching
  between count and list views, closing the panel, or unmounting aborts obsolete
  fetches.

### Changes

- Added `view=count` to `/api/notifications`; it executes only
  `countUnreadNotifications` and returns no notification items.
- Deferred the first compact notification list until the bell opens and kept
  list refreshes scoped to the open panel.
- Added a browser regression covering the closed-bell request shape, a combined
  focus/visibility/online burst, and one list request on open.
- Updated the notification architecture note and changelog. No roadmap decision
  changed.

### Safety

- Owner authentication, owner-scoped repository queries, and private no-store
  response headers are unchanged.
- Browser validation used only the disposable local `paperdeck_test` database;
  no shared Supabase data or configuration was read or changed.
- Pre-existing working-tree changes for durable feed exclusions were preserved.

### Validation

- `npx eslint src/components/notification-center.tsx src/app/api/notifications/route.ts tests/e2e/notifications.spec.ts`
- `npm run typecheck`
- `npm run lint`
- `bash scripts/run-e2e-local.sh tests/e2e/notifications.spec.ts` (`4/4`
  desktop/mobile tests passed after rebuilding the local test database from all
  30 migrations)
- `git diff --check`
