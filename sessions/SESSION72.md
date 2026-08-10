# Session 72

## Scope

- Investigate the Supabase Free-plan egress overage.
- Isolate local application development and the standard browser suite from
  the shared Supabase database.

## Findings

- The filtered Supabase usage screenshots attribute essentially all measured
  egress to PaperDeck through the Shared Pooler.
- Read-only statement statistics show repeated full-catalog reads, especially
  `paper_authors`, as the dominant database result volume.
- The previous local and CI Playwright configuration inherited a live Supabase
  `DATABASE_URL`, so ordinary regression runs repeatedly transferred the
  production catalog and wrote temporary test state remotely.

No secret, complete email address, collaboration hash, or personal record was
printed or stored in this session file.

## Decisions

- Production and Preview remain on the Supabase Transaction pooler.
- Local development uses PostgreSQL 17 plus pgvector 0.8.0 in Docker.
- A local catalog refresh may copy only public paper/taxonomy data; all private
  and collaboration data is excluded.
- Standard CI uses a small deterministic synthetic catalog and no Supabase
  database or API secrets.
- Standard Playwright is guarded to refuse non-loopback databases and any
  database not named `paperdeck_test`.
- The development snapshot lives in `paperdeck_local`, while Playwright resets
  the separate `paperdeck_test` database in the same container.
- Live Clerk Development and Supavisor probes remain explicit, separate tests.

## Implementation

- Added the pinned local database service in `compose.yaml`.
- Added `scripts/local-database.ts` for guarded schema resets, synthetic fixture
  setup, and temporary catalog-only dump/restore.
- Added `scripts/run-e2e-local.sh` and changed `npm run test:e2e` to use the
  isolated database automatically.
- Added a deterministic 24-paper catalog fixture and unit coverage for the
  destructive-target guard.
- Replaced App CI's remote database secrets with a pgvector service container.
- Documented the environment split and refresh/test commands in
  `docs/local-database.md`.

## Safety

- No remote row, user, session, environment variable, or schema was modified.
- The refresh source is read-only from the script's perspective and the dump
  table allowlist contains catalog data only.
- The destructive reset rejects remote hosts and rejects local databases whose
  name is not exactly `paperdeck_test`.
- Temporary catalog dumps are always removed.

## Validation

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test:unit`: 123/123 passed.
- `bash -n scripts/run-e2e-local.sh`: passed.
- Docker PostgreSQL 17 plus pgvector 0.8.0 catalog refresh: passed with 3,261
  papers, 14,339 author rows, 69 topics, and zero copied profiles.
- Targeted settings-interest Playwright regression: 2/2 passed across desktop
  and mobile.
- Full isolated `npm run test:e2e`: 74 passed and 6 expected Clerk-live skips
  across desktop and mobile.
- The separate `paperdeck_local` snapshot retained its catalog counts after
  Playwright reset and exercised `paperdeck_test`.
