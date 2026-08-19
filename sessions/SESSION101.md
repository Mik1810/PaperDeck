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
## Issue #215: App CI fast path

- Kept the existing `app-ci` job terminal for every pull request instead of
  filtering out the required workflow.
- Added a native Git changed-file classifier. Only `docs/**`, `sessions/**`,
  `README.md`, `ROADMAP.md`, and `CHANGELOG.md` use the lightweight path; empty
  diffs and every workflow, dependency, configuration, schema, script, source,
  or test change use full CI. Rename detection is disabled so a source file
  moved into an allowed documentation path still exposes its source deletion.
- The docs-only path checks patch integrity without setting up Node, installing
  dependencies, starting PostgreSQL, preparing the schema, building Next.js,
  installing Chromium, or running Playwright.
- Moved the existing pgvector PostgreSQL container startup from unconditional
  job services to the full-CI path, retaining its image, credentials, published
  port, and health policy.
- Limited full-CI browser installation to Playwright's Chromium headless shell
  while retaining Linux dependency installation.

## Validation

- Workflow YAML parsing: passed.
- Classifier allowlist, source/config fallback, rename safety, and empty-diff
  fallback cases: passed.
- Repository Playwright 1.61.1 CLI: confirmed support for `--only-shell`.
- Draft PR #217 full-CI attempts all passed, including the existing E2E suite:
  total job times were 5m08s, 2m24s, and 7m07s. The browser-install steps were
  188s, 33s, and 308s respectively: median 188s and worst 308s. The headless
  shell reduction therefore preserves the full gate but does not justify a
  speed-improvement claim; install variance remains high enough to evaluate an
  exact-version Playwright image separately.
- Stacked draft PR #218 changed only this session note and completed `app-ci`
  successfully in 8s, below the 45s target. GitHub reported checkout,
  classification, docs integrity, and summary as successful; Node setup,
  dependency installation, PostgreSQL, schema preparation, audit, lint,
  recommendation evaluation, build, browser installation, and E2E were all
  skipped.

## Environment boundary

The canonical disposable Docker database and local browser E2E paths were
unavailable because the Docker daemon was unavailable. No alternate database
or browser harness was substituted; full workflow and E2E behavior is validated
by the required GitHub Actions job for this CI-specific issue.
