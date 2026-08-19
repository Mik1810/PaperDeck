# Session 101

## Issue #100: private group discussion decision

- Recorded a no-go for discussion implementation until the private-group pilot
  completes the charter's 5–8 research trials and unsupported
  create → invite → add paper → revoke journey. The successful #99 Production
  smoke is deployment evidence, not a substitute for that product gate.
- Proposed a bounded conditional scope: one chronological plain-text channel per
  group, optional paper references over the same message model, no editing, and
  no direct messages, attachments, mentions, threads, rich HTML, email, push, or
  social-ranking input.
- Defined role controls, author deletion, moderated hiding, account closure,
  blocking/reporting, rate limits, XSS controls, separate discussion kill
  switches, export/delete rules, and bounded moderation evidence.
- Kept discussion unread state separate from durable notification acknowledgement
  and proposed widening the existing paper preference into one per-group
  `all`/`important_only`/`muted` preference with ten-minute activity
  aggregation.
- Named the project maintainer as operational moderation owner during the pilot
  and required a private runbook, appeal path, retention purge, and explicit
  workload acceptance before implementation.

## Environment boundary

- The canonical Docker database and browser E2E paths were unavailable because
  the Docker daemon was unavailable. This issue changes documentation only and
  does not require substitute database or browser evidence.

## Validation

- Product-owner approval recorded on 2026-08-19.
- Documentation consistency and targeted terminology review passed.
- Secret/PII pattern scan over the changed content passed.
- `git diff --check` passed.
- `scripts/pd-final-check` is the final repository baseline gate before
  publication.
