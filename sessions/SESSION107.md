# Session 107 — Parallel core and browser CI

## Scope

Implemented GitHub issue #232 by removing Playwright setup and browser execution
from the core `app-ci` critical path while retaining the existing isolated E2E
coverage.

## Changes

- Moved changed-file classification into a small shared job that exposes the
  selected mode to both validation layers.
- Kept `app-ci` as the terminal core check for docs-only changes and as the full
  audit, lint, unit, deterministic integration, recommendation, and build job for
  application changes.
- Added a parallel `browser-e2e` job with its own isolated pgvector database,
  dependency installation, migration-complete schema preparation, Chromium
  headless shell installation, and existing desktop/mobile Playwright suite.
- Split the GitHub step summaries so core and browser outcomes remain easy to
  distinguish.

## Validation

- GitHub Actions YAML parse and whitespace validation passed.
- Full isolated desktop/mobile Playwright suite passed against the guarded
  disposable `paperdeck_test` database: 104 passed and 10 expected live-auth
  skips in 55 seconds.
- Final repository baseline passed with `scripts/pd-final-check`.

No hosted database, schema, application data, or GitHub configuration was
modified.
