# Private Group Discussion Decision

Status: approved by the product owner on 2026-08-19.

Decision owner: PaperDeck product owner. Operational moderation owner: project
maintainer during the private pilot.

## Decision

PaperDeck is a **no-go for group-discussion implementation today**. The
Production smoke for the shared-paper workspace proves that the guarded path can
work, but it is not the successful private-group pilot required by issue #100.
The charter's 5–8 research trials and the unsupported
create → invite → add paper → revoke journey remain uncompleted.

After that pilot gate passes, PaperDeck has a conditional go for the bounded
scope below. Approval of this document resolves the product and security design;
it does not waive the pilot gate or authorize schema/application work.

## First-release product boundary

- Each group has one chronological discussion channel.
- A message may optionally reference one paper. A paper view is a filtered/deep-
  linked projection of the same channel, not a second channel or comment model.
- The canonical concept is a **group message**. Paper-linked comments and chat
  messages do not get separate tables, lifecycle rules, unread counters, or
  moderation paths.
- Messages are authenticated, group-private plain text with a maximum of 2,000
  Unicode characters. Newlines are allowed; HTML, Markdown rendering, embeds,
  link previews, and arbitrary rich content are not.
- There are no direct messages, attachments, reactions, mentions, deep threads,
  calls, email, push notifications, or public discussion.
- Discussion remains separate from private notes, playlists, reading history,
  interests, profile inputs, and ranking. It never creates a personal ranking
  signal for any participant.

Paper context remains readable when a paper is removed from the shared list. If
the catalog paper itself disappears, the message remains with an unavailable-
paper label and no stale copied abstract or full text.

## Roles and lifecycle

| Actor | Post | Change own message | Moderate | Control channel |
| --- | --- | --- | --- | --- |
| Owner | Yes | Delete | Hide member/admin content; restore; review reports | Enable/disable posting and discussion lifecycle |
| Admin | Yes | Delete | Hide member content; restore; review reports | Temporarily lock posting |
| Member | Yes | Delete | Report or block | No |
| Outsider/revoked member | No read or write | No | No | No |
| Project maintainer | Only as a normal member | Delete own | Resolve/appeal reports and remove content | Emergency discussion kill switches |

The first release has **no editing**. An author can delete their message at any
time and repost a correction. This avoids undisclosed edit history and preserves
a simple notification/unread contract. Editing requires a later decision about
revision visibility and moderation evidence.

Author deletion immediately removes the body and paper reference. A neutral
deleted-message tombstone preserves conversation order for 30 days, then is
hard-deleted. Owner/admin hiding immediately replaces the member-visible body
with a moderation tombstone. The original body moves to restricted moderation
evidence only when a report or moderation action requires it; it is never kept
in application logs.

Owner/admin authority is deliberately bounded. An admin cannot hide owner or
other-admin content. The owner can hide admin/member content but cannot resolve
an appeal against their own action. Reports involving the owner/admin, contested
actions, and appeals belong to the project maintainer. Permanent removal of
restricted evidence is an operational action, not a group-role privilege.

Revocation removes read/write access immediately. Previously authored active
messages stay visible while the group exists, with detached `Former member`
provenance. Account closure is stricter: it redacts the closing user's message
bodies and paper references, because the account owner can no longer exercise
message controls; only bounded report evidence may survive.

## Notifications, mute, and unread

Discussion widens the existing paper-notification preference into one group-level
preference, preserving its `all`/`important_only`/`muted` values and existing
member choices rather than adding a second mute setting:

- `all`: one durable discussion-activity notification per recipient and group
  in a ten-minute aggregation bucket;
- `important_only`: no ordinary message activity; paper-removal events and a
  moderation/report outcome directed at that user remain important;
- `muted`: no paper or discussion-activity notification. Security-critical
  membership/ownership events and a moderation decision directed at the user
  bypass the activity mute so access changes and appeal rights are not hidden.

There are no per-message notifications and no self-notifications. Notification
rows remain event pointers with the existing 90-day retention; they never copy a
message body. Realtime may prompt a refetch but is not a correctness dependency.
The initial delivery path is the existing durable inbox and polling only.

Channel unread state is independent from notification `read_at`. Each membership
stores a cursor over the latest successfully rendered visible message using
`(created_at, id)`. Unread counts include active messages after that cursor from
other authors. Hidden/deleted messages and the member's own messages do not
count; lifecycle changes do not make an old message unread again. Muting affects
notifications, not the in-group unread marker. A channel is marked read only
after its latest page has loaded while visible, never merely when navigation
starts.

## Moderation, safety, and abuse controls

The group owner/admin is first-line moderator for ordinary member content. The
project maintainer owns the report queue, owner/admin cases, appeals, privacy
requests, security incidents, and the decision to disable discussion. Before a
beta, the maintainer must have a private runbook and accept this workload; GitHub
issues are not a moderation queue.

The first implementation must provide:

- report reasons with an optional bounded plain-text explanation, reporter
  confidentiality from other group members, status, resolution, and appeal;
- the existing account block control; within a shared group, blocked-author
  messages are collapsed for the blocker but membership is not silently removed;
- database-backed authenticated limits starting at 10 messages per minute and
  200 per day per account/group, plus 5 reports per day per account; thresholds
  are configurable without a deploy;
- server-side length/control-character validation and authorization on every
  read and mutation, with RLS as defense in depth;
- plain-text React rendering without `dangerouslySetInnerHTML`, plus regression
  cases for HTML/script payloads, encoded markup, URLs, Unicode, and oversized
  input;
- discussion-specific read and write kill switches so an incident can stop chat
  without disabling the shared paper list or account-closure cleanup.

Rate-limit records contain scoped identifiers and counters only, expire with
their enforcement window, and never contain message text or raw IP addresses.
Platform-level abuse controls may supplement them but cannot be required paid
infrastructure.

## Retention, export, and deletion

| Data | Retention | Export/deletion behavior |
| --- | --- | --- |
| Active message | Group lifetime | Visible to current members; author export includes own messages; account closure redacts the body |
| Author-deleted tombstone | 30 days | Body/reference purged immediately; tombstone excluded from export |
| Moderation tombstone | While group exists or until action is reversed | Member export exposes status only, never restricted evidence |
| Report and restricted evidence | Until resolution + 90 days, with a 180-day maximum while open | Maintainer-only; excluded from group/user export except the reporter's own submitted explanation |
| Moderation/security audit event | 90 days | Maintainer-only metadata; no message body |
| Discussion notification | 90 days | Existing recipient-owned notification export/delete rules |
| Unread cursor/rate-limit counter | Membership lifetime / enforcement window | Operational state, deleted with membership or expiry |

Deleting a group immediately removes active discussion and cursors. Restricted
evidence for an open or recently resolved report follows its bounded moderation
retention, then is purged by an idempotent scheduled job. A current member may
export their own messages; only the owner can request a whole-group export of the
conversation visible to current members, and that action is audited. No export
includes reports, blocks, private notes, emails, Clerk IDs, or other members'
private PaperDeck data.

## Threat model

| Threat | Required control and evidence |
| --- | --- |
| Cross-group read/write | Membership-rooted queries, RLS, private/no-store routes, and owner/admin/member/outsider/revoked tests |
| Stale access after revocation | Transactional membership checks on every mutation, cache/logout tests, and immediate cursor/session denial |
| Stored/reflected XSS or unsafe links | Plain-text-only storage/rendering, no rich linkification, CSP, and adversarial component/API tests |
| Spam or notification flooding | Database-backed per-account/group limits, ten-minute notification aggregation, mute preferences, and kill switch |
| Moderator abuse or report disclosure | Bounded role matrix, confidential reports, restricted evidence, audited actions, maintainer appeals |
| Block bypass in a shared group | Collapsed blocked-author content, no mentions/DMs, and explicit owner removal when coexistence is unsafe |
| Deleted content retained indefinitely | Immediate body redaction, explicit evidence deadlines, bounded purge job, and retention metrics |
| Private/ranking data leakage | Separate discussion domain and projections; tests proving zero private-library/profile/ranking writes |
| Log, notification, or export leakage | No bodies in logs/notifications, allowlisted exports, redaction tests, and server-only operations |
| Cost/resource exhaustion | Size/page caps, indexed keyset pagination, free-first storage metrics, and configurable write limits |

## Gates and stop conditions

Implementation may start only after all of these are true:

1. The private-group pilot completes 5–8 consented trials/interviews and users
   complete create → invite → add paper → revoke without support.
2. No unresolved cross-user leak, cache incident, revocation defect, ranking
   contamination, or account-deletion defect exists in the group workspace.
3. The product owner approves this decision record and confirms demand for
   discussion, not merely shared-paper annotations.
4. The maintainer accepts the moderation runbook, response ownership, retention
   job, and beta volume.
5. A separate implementation issue defines migration, RLS/repository surface,
   feature flags, responsive UX, and the tests in this threat model.

Rollout is an allowlisted internal alpha followed by the same small private beta,
with discussion disabled by default for every group. Stop writes immediately for
any cross-group leak, non-immediate revocation, unmanageable abuse queue,
evidence-retention failure, ranking write, or recurring cost incompatible with
the free-first constraint. Disable reads as well only when continued visibility
is itself unsafe. Resumption requires a written root-cause review and regression
evidence.

## Explicitly deferred decisions

Message editing/history, reactions, mentions, threads, separate per-paper
channels, direct messages, attachments, rich text, link previews, email/push,
public discussion, automated moderation, and social-ranking use require their
own evidence and approval. They are not implied by a successful first release.
