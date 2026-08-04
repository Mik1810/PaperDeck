# Session 62

## Fix build failure after merge on `agent/notification-center`

- Vercel preview build failed during `next build` TypeScript with
  `src/app/actions.ts:349` — `Cannot find name 'requireUuid'`.
- Root cause: the merge commit `720b988` (`Merge branch 'main' into
  agent/notification-center`) resolved the `actions.ts` conflict by keeping
  main's `const uuidPattern` but dropping the branch's `requireUuid` helper.
  The notification-center actions still call `requireUuid` six times, so the
  merged file referenced a symbol that no longer existed.
- Re-added `requireUuid(value, label)` after the `uuidPattern` constant, using
  the existing pattern so the merge keeps main's regex while restoring the
  branch's validation helper.

## Validation

- `npm run typecheck` passed
- `npm run lint` passed
- `npm run build` passed (`/notifications` route present, production build OK)
- `npm run test:unit` passed (`114/114`)
- Verified `src/lib/repositories/notifications.ts` kept the full branch surface
  (`markNotificationRead`, `markAllNotificationsRead`, `archiveNotification`).
