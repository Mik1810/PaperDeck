# SESSION106

Date: 2026-08-19

## Goal

Make classic-paper persistence atomic per discovered Semantic Scholar paper (#225).

## Changes

- Added the service-role-only `upsert_classic_paper_bundle(jsonb)` RPC, which persists paper metadata, external IDs, ordered authors, and curated classic topics in one transaction.
- Serialized available Semantic Scholar, arXiv, DOI, and normalized-title identities in stable order before resolving and locking the target paper row.
- Replaced the classic worker's independent REST mutation chain with one whole-bundle RPC and bounded transient-database retries.
- Preserved the existing dry-run behavior, candidate filters, per-query cap, new-paper cap, additive classic-topic behavior, and empty-author preservation behavior.
- Added local integration coverage for rollback after author deletion, complete success, idempotent retry, concurrent discovery, and RPC privileges, plus a unit guard against reintroducing table-write chains.

## Validation

- `node --import tsx --test tests/unit/classic-paper-atomicity.test.ts`
- `npx eslint scripts/discover-classic-papers.ts tests/unit/classic-paper-atomicity.test.ts tests/integration/classic-paper-bundle.test.ts`
- `scripts/pd-db-run npm run db:test:prepare`
- `scripts/pd-db-run env PAPERDECK_RUN_CLASSIC_BUNDLE_INTEGRATION=true node --conditions react-server --import tsx --test tests/integration/classic-paper-bundle.test.ts`
- `scripts/pd-db-run npm run test:integration:ci` (58 tests passed)
- `TMPDIR=/tmp npm run discover:classics -- --dry-run --per-query=1 --max-new-per-query=1 --only="transformer neural machine translation"`
- `scripts/pd-final-check`

## Hosted State

- No hosted database migration or data mutation was performed.
