# SESSION 103

Date: 2026-08-19
Task: Stop logging stable owner identifiers with paper activity (#222)

## Work Log

- Added a central structured-logging allowlist with opaque per-event correlation
  IDs and safe error classification.
- Removed stable owner, paper, recommendation-batch, and batch-item identifiers
  from deck, impression, onboarding, feed, and background-refresh events.
- Replaced nested onboarding result payloads with coarse status and count fields;
  removed raw error messages, stacks, and provider metadata in every environment.
- Added sentinel regression coverage for deck and impression failures plus
  retained timing, semantic, error-class, and SQLSTATE diagnostics.
- Documented the operational logging contract in `docs/security.md`.

## Validation

- `node --conditions react-server --import tsx --test tests/unit/logger-privacy.test.ts`
  passed with 3 tests.
- `npm run typecheck` passed.
- `npm run test:unit` passed with 184 tests.
- `npm run lint` passed.
