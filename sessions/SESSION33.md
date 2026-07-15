# Session 33 — Mutual friend requests and blocks

## Scope

Implemented GitHub issue #94 on top of collaboration identity discovery.

## Decisions

- A crossed request automatically accepts the existing incoming request.
- Decline prevents only the declined requester from retrying for 30 days; the recipient may initiate later.
- Cancel and unfriend have no cooldown. Unblock restores discoverability but never restores a request or friendship.
- Pending requests do not expire yet and remain visible in Settings until answered or cancelled.
- Each actor may create at most 10 requests in a rolling 24-hour window.
- Notifications remain out of scope until the durable-notification issues; Settings is the interim inbox.

## Changes

- Added `friend_requests`, canonical `friendships`, and directional `user_blocks` with participant-only RLS reads and RPC-only writes.
- Added transaction advisory locks, idempotent lifecycle RPCs, partial uniqueness for pending pairs, cooldown and rate-limit enforcement.
- Extended exact-email discovery with minimal relationship state while hiding profiles after a block in either direction.
- Added Add friend, Accept, Decline, Cancel, Unfriend, Block, and Unblock actions to Search and Settings.
- Added a private Connections panel for incoming/outgoing requests, friends, and the actor's blocked-user list.
- Added integration coverage for crossed/duplicate requests, authorization, cooldown, idempotency, rate limiting, block visibility, direct-write denial, and ranking isolation.
- Fixed a legacy-account edge case found during the two-account UI check: Search now lazily creates a missing collaboration identity before sending, and a database trigger rejects any future request whose sender has no public identity. The existing Michael-to-Test-A request was repaired without storing plaintext email.
- Made a single populated Connections category use the full panel width; the internal two-column layout now activates only when multiple categories are visible.

## Validation

- `npm run typecheck`
- `npm run lint`
- `npm run test:integration`
- `npm run test:unit`
- `npm run build`
