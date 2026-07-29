# Session 49

## Persisted recommendation provenance

- Added nullable `recommendations.candidate_source` with an allowlist check for
  `semantic` and `catalog_fallback`.
- Kept historical rows `NULL`; no provenance was inferred or backfilled.
- Stored candidate provenance when writing new initial and live recommendation
  batches.
- Restored persisted provenance when reading cached batches, with
  `initial_batch` or `live_batch` retained for historical rows.
- Updated the Drizzle schema, canonical Supabase schema, migration,
  documentation, changelog, and unit coverage.

## Validation

- `npm run lint`
- `npm run typecheck`
- `npm run test:unit` — 84 passed
- `npm run audit:service-role`
- `npm run build`
- `git diff --check`
- Supabase Development schema verification — nullable text column and allowlist
  constraint present; 2,576 historical recommendation rows remained `NULL`.
- Supabase security and performance advisors — no new finding caused by this
  migration; pre-existing project-wide advisories remain out of scope.
