# Session 110

## Issue #238: enrichment worker hardening

### Scope and decisions

- Accepted the documented Semantic Scholar response variant where
  `openAccessPdf.status` is `null`; valid entries in the same positional batch
  continue to resolve independently from provider misses.
- Added a 30-second default timeout to each Unpaywall request, configurable with
  `--request-timeout-ms` or `UNPAYWALL_REQUEST_TIMEOUT_MS`.
- Combined the timeout signal with an optional caller signal. Network failures,
  timeout, and caller abort all use the existing retryable-provider path and
  persisted exponential backoff.
- Kept `found`, `not_found`, and `not_oa` terminal so completed outcomes remain
  excluded from subsequent candidate scans.

### Validation

- Focused unit tests cover nullable Semantic Scholar OA status in a mixed batch,
  Unpaywall timeout and caller abort, persisted `retryable_error`, and exclusion
  of completed outcomes.
- TypeScript typecheck passed before the final repository gate.
- No provider API, Production worker, hosted database, or hosted configuration
  was accessed or changed.
