# Session 104 — App CI deterministic and mobile regression coverage

## Scope

Implemented GitHub issue #221 by extending full App CI with regression suites
that already existed locally but were absent from the required gate.

## Changes

- Added `npm run test:integration:ci`, backed by a serial runner that rejects
  every database except localhost/`paperdeck_test` and enables only deterministic
  local integration suites. Live Clerk and hosted-service tests remain outside
  the aggregate by construction.
- Added unit and deterministic-database integration steps to full App CI and to
  its job summary. The docs-only classifier remains unchanged.
- Enabled both the desktop Chromium and Pixel 5 Playwright projects in CI.
- Added a Pixel 5 regression that sends Chromium touch input from inside the
  paper card's inner scroll region and verifies that the deck advances.
- Made the existing browser-back regression wait until the clicked paper ID is
  durably recorded in session storage before navigating back. Running the new
  mobile matrix exposed a client-navigation race: a delayed initial `pageshow`
  could consume a newly written marker before navigation. The feed now handles
  `pageshow` only for BFCache restores while retaining its immediate mount-time
  check for ordinary back navigation.

## Integration selection

The aggregate deliberately excludes the hosted Clerk tests, the legacy direct
authenticated-table RLS probe, and the research-group paper migration harness.
The latter owns a separate temporary PostgreSQL cluster because it validates
intermediate migrations rather than the canonical migration-complete database.

## Validation

- Canonical disposable database preparation: passed with 35 migrations and the
  60-paper synthetic fixture.
- `npm run test:integration:ci`: 50/50 passed in 19 seconds.
- `npm run test:unit`: 184/184 passed.
- Targeted Pixel 5 inner-scroll touch swipe: passed.
- Targeted recommendation sequence plus browser-back regression: 4/4 passed
  across desktop Chromium and Pixel 5 after fixing the `pageshow` race.
- Full desktop and Pixel 5 Playwright matrix: 104 passed and 10 expected
  live-auth skips in 55 seconds.
- A remote database URL was rejected before the integration runner started.

No hosted database, service, schema, or application data was modified.
