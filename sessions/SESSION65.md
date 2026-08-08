# Session 65

## Issue #126: automatic RLS helper hardening

- Audited the current Supabase security-advisor findings without modifying the
  shared database.
- Confirmed the authenticated collaboration RPC findings are intentional: the
  functions derive the actor from the JWT, use fixed search paths, deny
  `PUBLIC` and `anon`, and have negative isolation coverage.
- Confirmed `collaboration_search_limits`, `ingestion_cursors`, and
  `ingestion_runs` are RLS-enabled default-deny tables with no policies. Moving
  the public `vector` and `pg_trgm` extensions was left outside this targeted
  hardening because it would require a separate dependency migration.
- Identified one minimal defense-in-depth change: Supabase's managed
  `public.rls_auto_enable()` event-trigger helper does not need direct execution
  grants for API roles.
- Added a conditional migration that revokes `EXECUTE` from `PUBLIC`, `anon`,
  and `authenticated` when the helper exists. It does not replace, alter, move,
  or disable the function or its event trigger.
- Added a disposable local PostgreSQL test that installs a representative
  automatic-RLS event trigger, applies the migration, verifies all three grants
  are gone, creates a public table and confirms RLS is still enabled
  automatically, then proves the migration is safe when the managed helper is
  absent.
- The migration has not been applied to the shared PaperDeck Supabase project.
  That remains a separately approved operation. No application rows, accounts,
  sessions, or shared database settings were changed.

## Validation

- `npm run test:migration:rls-auto-enable`.
- `npm run typecheck`.
- `npm run lint`.
- `npm run test:unit` (`114/114` passed).
- `TMPDIR=/tmp npm run build`.
- `git diff --check`.
