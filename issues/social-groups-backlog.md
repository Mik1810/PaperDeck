---
## Approve research-group charter, privacy matrix, and threat model
labels: area:product, area:docs, priority:p1, type:enhancement

Parent: #37

Turn the approved direction for private research groups into a release gate.

### Scope

- Confirm small private research groups as the initial audience.
- Document exact-email discovery disabled by default with a Settings opt-in.
- Complete the data audience, retention, export, delete, account-closure, block, and abuse matrix.
- Assign an operational owner for privacy, reports, and incidents.
- Define non-goals: no public directory, followers, people recommendations, public feed, or implicit sharing of private PaperDeck data.
- Record the planned 5–8 research-user interviews and their evaluation questions.

### Done when

- The decision record and threat model are approved.
- Release gates and stop conditions are explicit.
- `ROADMAP.md` and `docs/social-interactions-plan.md` agree.

---
## Define a measurable recommendation-core stability gate
labels: area:recommendations, area:analytics, priority:p1, type:test

Parent: #37

Social activity must not mask or silently influence an unstable personal ranker.

### Scope

- Pin the current ranker/model version and evaluation fixture.
- Define repeatable quality, coverage, repetition, and latency metrics.
- Add a small offline or database-backed evaluation command.
- Verify friendship, group, notification, and shared-paper events cannot write ranking signals without a separate opt-in experiment.
- Document acceptance thresholds and observability.

### Done when

- The evaluation is repeatable and documented.
- Thresholds are approved.
- Social-domain tests prove no ranking/profile side effects.

---
## Prove Clerk JWT and Supabase RLS isolation before collaboration data
labels: area/auth, area:security, area:database, priority:p0, type:enhancement

Parent: #37

This issue establishes the Clerk JWT/Supabase RLS foundation required before collaboration work.

### Scope

- Add deterministic database tests with user A, user B, and an unauthenticated actor.
- Prove cross-user reads, updates, deletes, and foreign-owner inserts fail closed.
- Prove missing or unrelated claims cannot read protected rows.
- Add a real two-session Clerk Development smoke through the Supabase anonymous client.
- Verify temporary sessions are always revoked and no password or token is persisted.
- Define and audit authenticated-client and service-role boundaries.
- Document deployment configuration without exposing secrets.

### Separated follow-ups

- Preview and Production release verification: #104.
- Owner/admin/member/outsider/revoked group matrix: #95.
- Authenticated-route cache, PWA, and shared-device logout hardening: #103.

### Done when

- Deterministic A/B/anonymous negative RLS tests pass.
- The Clerk Development A/B smoke proves token acceptance and isolation.
- Cross-user reads and writes are denied by default.
- Service-role access remains limited, server-only, and audited.

---
## Add collaboration profiles and exact-email discovery controls
labels: area:settings, area:security, area:data-model, priority:p1, type:enhancement

Parent: #37

Blocked by: Clerk JWT/RLS foundation.

Create an identity surface separate from private PaperDeck profiles.

### Scope

- Add a collaboration profile with user-chosen display name and optional image.
- Add exact-email discoverability disabled by default with a Settings opt-in.
- Add group invite policy: `nobody`, `friends_only`, or `anyone` (default `friends_only`).
- Implement exact-match lookup only: no prefix search, autocomplete, or public directory.
- Return a generic result for nonexistent and undiscoverable accounts where possible.
- Index only a normalized, server-HMAC email lookup value; never store plaintext lookup email or a reversible/unsalted digest in collaboration tables.
- Define primary-email change and removal synchronization without provider-specific canonicalization.
- Never expose email, Clerk ID, interests, history, or private profile fallback in group UI.
- Add rate limits and audit-safe logs.

### Done when

- Discovery requires opt-in and resists enumeration.
- Settings are recoverable and tested on mobile.
- RLS and application authorization agree.

---
## Add mutual friend requests, cooldowns, and user blocks
labels: area:backend, area:security, priority:p1, type:enhancement

Parent: #37

Blocked by: collaboration profiles and exact-email discovery.

### Scope

- Model pending, accepted, declined, and cancelled friend requests.
- Treat friendship as mutual only after acceptance.
- Prevent duplicate and crossed requests transactionally.
- Enforce a 30-day cooldown after decline.
- Add cancel, unfriend, block, and unblock flows.
- Make blocks prevent discovery responses, requests, invitations, and group interactions where applicable.
- Add rate limits and owner/target/outsider authorization tests.

### Done when

- All state transitions are idempotent and tested.
- Blocks and cooldowns are enforced server-side.
- Friendship has no ranking side effects or public counters.

---
## Add private research-group schema, ACL, and ownership succession
labels: area:architecture, area:security, area:data-model, priority:p0, type:enhancement

Parent: #37

Blocked by: Clerk JWT/RLS foundation and approved threat model.

### Scope

- Add private groups with one shared paper list per group.
- Add owner, admin, and member roles.
- Centralize permission checks and return not-found-equivalent responses to outsiders.
- Permit invitations only from owner/admin; membership always requires acceptance.
- Allow the owner to select a successor.
- On owner deletion, transfer to the selected successor, else oldest active admin, else oldest active member; delete only when no successor exists.
- Add revision/lifecycle fields, feature flag, kill switch, and negative ACL/RLS tests.

### Done when

- Owner/admin/member/outsider/revoked matrices pass.
- Ownership transfer and account deletion are deterministic and transactional.
- Existing private playlists cannot be converted or exposed.

---
## Add research-group invitations and membership management
labels: area:backend, area:security, priority:p1, type:enhancement

Parent: #37

Blocked by: group schema/ACL, friendship flows, and collaboration preferences.

### Scope

- Invite registered PaperDeck users selected by exact email.
- Enforce target invite policy: nobody, friends only, or anyone.
- Require explicit accept/decline; never add users automatically.
- Support expiration, cancellation, revocation, role changes, removal, and immediate access loss.
- Prevent duplicate invitations and race conditions.
- Keep email delivery and invitations to unregistered addresses out of scope.

### Done when

- Invite lifecycle and authorization tests pass for every role and policy.
- Revocation removes read/write access and stale cache immediately.
- No raw email or invite secret appears in group payloads or logs.

---
## Add durable notification events and private realtime delivery
labels: area:architecture, area:database, area:security, priority:p1, type:enhancement

Parent: #37

Blocked by: Clerk JWT/RLS foundation.

### Scope

- Add durable recipient-owned notifications with type, source references, dedupe key, read/archive timestamps, and 90-day retention.
- Keep friend requests, group invitations, memberships, and paper-list rows as authoritative state.
- Insert domain change and notification atomically.
- Broadcast only a private "notifications changed" signal; clients refetch authorized rows.
- Support at-least-once delivery, deduplication, reconnect/refetch, and non-realtime fallback.
- Include friendship, invitation, membership, role, ownership, and shared-paper activity events.
- Aggregate bursts of paper activity per actor/group.

### Done when

- Offline/reconnect does not lose notifications.
- RLS restricts rows and private channels to the recipient.
- No email, token, message body, or sensitive profile data enters broadcast payloads or logs.

---
## Add notification bell, actionable menu, and history page
labels: area:frontend, area:ux, area:pwa, priority:p1, type:enhancement

Parent: #37

Blocked by: durable notification events.

### Scope

- Add an authenticated-header bell with unread badge capped at `99+`.
- Show the latest 20 notifications in a desktop popover and mobile bottom sheet.
- Pin actionable friend requests and group invitations above paper activity.
- Provide inline Accept/Decline and explicit `Mark all as read`.
- Add a paginated history page with All, Requests, Groups, read/unread, and archive controls.
- Show a small, silent, dismissible toast only for important events; paper activity updates badge/menu without a toast.
- Support per-group `all`, `important_only`, and `muted` preferences while keeping security-critical events visible.

### Done when

- Keyboard, screen-reader, mobile safe-area, loading, empty, error, and reconnect states pass.
- Actions validate current source state and cannot be completed from stale notifications.
- Authenticated routes remain network-only in the PWA.

---
## Add the single shared paper list and paper-activity notifications
labels: area:backend, area:frontend, area:data-model, priority:p1, type:enhancement

Parent: #37

Blocked by: group ACL/membership and durable notifications.

### Scope

- Add, remove, and reorder catalog papers in the group's single shared list.
- Record actor, timestamps, stable positions, and minimal activity.
- Notify members when papers are added; aggregate bursts such as "added 4 papers".
- Notify the original contributor when their paper is removed without spamming every member.
- Keep personal favorites, Read later, notes, impressions, and ranking signals isolated.
- Allow an explicit copy to the member's own private library.

### Done when

- Concurrent reorder conflicts are explicit and lossless.
- Paper activity respects group notification preferences.
- Cross-user, revoked-member, mobile, and ranking-isolation tests pass.

---
## Design group chat linked to shared papers before implementation
labels: area:product, area:architecture, area:security, priority:p2, question

Parent: #37

Blocked by: successful private-group pilot.

Record and resolve the future chat design without implementing it prematurely.

### Questions

- One group channel or additional paper-linked contexts?
- Message editing/deletion lifecycle and retention?
- Notification aggregation, per-group mute, and unread semantics?
- Moderation, blocks, rate limits, XSS, export, account deletion, and owner/admin controls?
- Whether paper-linked discussion should be comments, chat messages, or one unified model?

### Non-goals for the first decision

- No direct messages, attachments, rich HTML, deep threads, calls, email, or push notifications.

### Done when

- A written go/no-go and bounded first-chat scope are approved.
- Threat model, moderation owner, retention, and notification behavior are explicit.
