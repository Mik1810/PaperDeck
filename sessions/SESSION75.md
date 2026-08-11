# SESSION75

## Scope

GitHub issue #170: make local development and App CI rebuild the same current
database shape represented by PaperDeck's ordered Supabase migration history.

## Cause

The guarded Docker reset executed only `supabase/schema.sql`. That file had
become a partial current-state snapshot, while later features such as catalog
full-text/trigram search existed only in migrations and on the hosted database.
Consequently local and CI PostgreSQL lacked `pg_trgm` and
`papers.search_vector`, so the normal search query could fail despite working
in Production.

## Changes

- Restored `supabase/schema.sql` to the immutable pre-migration baseline.
- Made the local database runner apply every timestamped migration in lexical
  order, one transaction per file.
- Added a fail-fast schema check for the search extension, generated column,
  indexes and real query expression.
- Added an explicit schema-parity step to App CI before build and Playwright.
- Removed the stale Drizzle-only interaction uniqueness declaration that is not
  present in either the hosted or migration-built schema.
- Documented the baseline-plus-migrations contract in the roadmap, local
  database guide and changelog.

## Safety

All destructive setup remains guarded to loopback hosts and the exact local
database names `paperdeck_test` or `paperdeck_local`. No hosted schema, migration
metadata, application data, credentials or personal records were modified.

## Validation

- `npm run db:test:prepare`: passed; 27 migrations applied and search schema
  verified before loading 24 synthetic papers.
- `npm run test:unit`: 133 passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- Targeted Search E2E: 2 passed across desktop Chromium and mobile Chrome.
- Full Playwright: 74 passed, 7 expected Clerk-auth skips and one unrelated
  mobile browser-back timeout; the exact failed case passed immediately when
  rerun alone (1 passed in 2.1 seconds).
