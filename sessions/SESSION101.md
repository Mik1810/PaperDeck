# Session 101

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
- Remote docs-only and three-run full-CI timing evidence: pending draft-PR
  validation.

## Environment boundary

The canonical disposable Docker database and local browser E2E paths were
unavailable because the Docker daemon was unavailable. No alternate database
or browser harness was substituted; full workflow and E2E behavior is validated
by the required GitHub Actions job for this CI-specific issue.
