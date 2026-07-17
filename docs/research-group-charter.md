# Private Research-Group Charter

Status: approved on 2026-07-18 for the initial invite-only pilot.

## Product boundary

PaperDeck may help small private research groups maintain one shared paper list.
It does not become a general social network. Personal feeds, interests, ranking
signals, favorites, private playlists, notes, and reading history remain private.

The initial program has no public directory, followers, people recommendations,
public feed, implicit sharing, contact import, anonymous content, or social
ranking. Public profiles, public collections, and group chat require separate
go/no-go decisions.

## Identity and discovery

Exact-email discovery is opt-in. A new or existing account is undiscoverable
until its owner explicitly enables the setting. Search accepts only a complete
email address and returns a minimal collaboration profile, never the address,
Clerk ID, private profile fallback, interests, or history. Missing and
undiscoverable profiles return an equivalent result.

This is the approved target policy. The schema-default change and safe migration
of existing collaboration identities are implementation work tracked in #93.

The email lookup uses a server-side HMAC, is rate-limited, and must not be logged.
The default invitation policy remains `friends_only`.

## Roles

| Role | Shared paper list | Members and invites | Group lifecycle |
| --- | --- | --- | --- |
| Owner | Read, add, remove, and reorder | Invite, remove, and assign roles | Choose successor and delete the group |
| Admin | Read, add, remove, and reorder | Invite and remove members | Cannot transfer ownership or delete the group |
| Member | Read, add, and remove papers | No member or invite management | Cannot change roles or group lifecycle |
| Outsider or revoked member | No access; respond as not found | No access | No access |

Every invitation requires explicit acceptance. A group has one shared paper list
separate from every member's private playlists. Copying a shared paper into a
private library is an explicit personal action and does not affect other users.

## Data lifecycle

| Data | Audience | Retention and revocation | Export and deletion |
| --- | --- | --- | --- |
| Collaboration identity | The owner; minimal projection after an exact opted-in lookup | Account lifetime or until discovery/profile removal | Export owner fields; delete on account closure |
| Friend request | Requester and recipient | Pending until acted on or cancelled; declined state for 30 days to enforce cooldown | Export the user's side; delete on account closure |
| Friendship or block | The affected accounts | While active; remove on unfriend, unblock, or account closure | Export the user's state; never expose private data from the other account |
| Group invitation | Inviter and recipient | Seven days, single use, and immediately revocable | Export status to the relevant actor; purge token material after expiry or use |
| Membership | Current authorized members | While active; revocation removes read and write access immediately | Export the user's membership; remove or revoke on closure |
| Shared papers | Current authorized members | Group lifetime | Export group data only while authorized; group deletion removes the list |
| Notifications and minimal group activity | Intended recipients or authorized members | 90 days | Export the user's notifications/actions; purge after retention |
| Rate-limit state | Authorized operations only | Only for the enforced time window | Not part of the product export; purge automatically |
| Security audit events | Project maintainer | 90 days, minimized and redacted | Operational data only; never include secrets, raw emails, tokens, or user content |

Abuse reports and public user-generated content are outside the initial pilot.
They cannot launch until their workflow, access, appeal, and retention rules are
approved separately.

## Account closure

Account closure revokes sessions, invitations, capabilities, friendships,
blocks, and memberships, then deletes the collaboration identity and all private
PaperDeck data. Group ownership transfers to the selected successor, otherwise
the oldest active admin, then the oldest active member; the group is deleted only
when no successor exists.

Shared papers remain with a surviving group. Any retained provenance is detached
from the closed account and displayed generically as `Former member`. No private
profile, email, Clerk identifier, or ranking data survives through that label.

## Operational ownership

The project maintainer owns privacy requests, abuse reports, and security
incidents during the pilot. The maintainer may disable collaboration immediately
through the feature flag or kill switch. Operational notes containing personal
or incident-sensitive information stay in a private operations log, not the
repository or GitHub issues.

## Threat model and controls

| Threat | Required control |
| --- | --- |
| Account enumeration by email | Opt-in discovery, exact match, generic misses, HMAC lookup, and rate limiting |
| Cross-user or privilege-escalation access | Central role checks, RLS, negative owner/admin/member/outsider/revoked tests |
| Stale access after revocation | Transactional revocation, network-only authenticated routes, and shared-device cache tests |
| Stolen invitation | Seven-day expiry, single use, revocation, stored digest only, and no token logging |
| Private-data leakage into collaboration | Separate tables and explicit projections; no reuse of private playlists or profiles |
| Social activity changing personal ranking | Separate data domain and regression tests proving no ranking/profile writes |
| Account closure retaining identity | Transactional cleanup, ownership succession, and detached `Former member` provenance |
| Operational or log exposure | Server-only privileged access, allowlisted/redacted logs, minimal retention, and incident runbook |

## Release gates and stop conditions

The pilot requires the recommendation gate, JWT/RLS isolation foundation,
negative group-role tests, authenticated-route cache/logout checks, environment-
specific Clerk/Supabase smoke, feature flag, kill switch, and a tested account
closure path.

Stop or disable the pilot immediately after any cross-user or cache leak,
non-immediate membership revocation, social write into personal ranking data,
failed export/deletion path, abuse load the maintainer cannot handle, or recurring
cost incompatible with the free-first constraint. Resumption requires a written
root-cause review and passing regression coverage.

## Research-user validation

Plan 5–8 interviews or observed trials with researchers or small labs before a
broader beta. Record only consented, minimized notes. Evaluation questions:

1. How is a paper shortlist shared today, and where is context lost?
2. Is one shared list per group sufficient for the pilot?
3. Who should add, remove, reorder, invite, or remove members?
4. Is exact-email opt-in understandable and discoverable?
5. Can participants distinguish shared data from their private PaperDeck data?
6. Do invitation, acceptance, block, leave, and revocation behave as expected?
7. Does account closure and `Former member` provenance match expectations?
8. Would the group complete create, invite, add paper, and revoke without support?

The interview plan is approved by this charter; completing the interviews is a
pilot input, not permission to bypass any security gate.
