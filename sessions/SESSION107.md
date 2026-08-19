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
  dependency installation, migration-complete schema preparation, and existing
  desktop/mobile Playwright suite in the official Noble Playwright container.
- Derived the container tag from the installed Playwright package version and
  used host networking so the existing loopback-only test database guard remains
  unchanged. The image supplies Chromium and its Linux dependencies together.
- Split the GitHub step summaries so core and browser outcomes remain easy to
  distinguish.

## Validation

- GitHub Actions YAML parse and whitespace validation passed.
- The initial cache experiment resolved Playwright 1.61.1 to Chromium headless
  shell revision 1228, but the successful remote run spent 9 minutes 53 seconds
  installing nine missing Linux packages while the browser download took only 6
  seconds; the complete browser job took 12 minutes 19 seconds.
- The version-matched official container pulled in 22 seconds on GitHub. Its E2E
  step completed in 2 minutes 5 seconds and the full browser job passed in 2
  minutes 40 seconds: 103 passed, 1 flaky retry, and 10 expected live-auth skips.
- Full isolated desktop/mobile Playwright suite passed against the guarded
  disposable `paperdeck_test` database: 104 passed and 10 expected live-auth
  skips in 55 seconds.
- Final repository baseline passed with `scripts/pd-final-check`.

No hosted database, schema, application data, or GitHub configuration was
modified.
