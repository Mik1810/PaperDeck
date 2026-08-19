# Session 102

## Issue #220: embedding scan progress

- Replaced the paper worker's fixed oldest-first inspection prefix with two
  bounded server-side scan phases: missing vectors first, followed by embedded
  paper metadata for model and content-hash staleness.
- Kept each REST response capped at 1,000 metadata rows and removed the vector
  column from candidate-discovery responses.
- Added actual inspected-row, scan-completion, and stop-status output so an
  exhausted fresh catalog is distinguishable from a candidate-limited run.
- Added `--classic-only` and enabled it in the classic-discovery post-step, so
  newly eligible classics do not depend on global catalog ordering.
- Added a local `--until-fresh` mode that loads the model once, drains bounded
  batches with a configurable safety cap, writes batch events only to an
  ignored JSON Lines `.log`, and preserves one terminal stdout summary for the
  existing Actions integration.
- Added deterministic Python regression coverage for a missing paper beyond the
  former 1,024-row prefix, repeated bounded progress, model/hash staleness,
  vector-free REST selection, classic filtering, and quiet logged backfills.
- A Production backfill audit found 3,462 missing embeddings among 4,793 papers
  and no stale model/hash rows. The user-run backfill durably wrote 486 vectors,
  then stopped with a temporary DNS resolution failure; 2,976 missing rows
  remained in the immediate read-only audit.
- Added bounded exponential retry for transient REST DNS, connection, timeout,
  rate-limit, and server errors, plus terminal `run_failed` logging. Permanent
  HTTP errors still fail immediately.

## Environment boundary

- Docker was initially unavailable, then restored. Database validation used the
  canonical compose service and its current dynamically published endpoint;
  the stale documented/default port was not used as acceptance evidence.
- Browser E2E was not required for this worker-only issue. No alternate database
  or browser harness was used.

## Validation

- `python3 -m unittest tests.python.test_embed_papers`: 7 passed.
- `python3 -m unittest tests.python.test_embedding_common`: 3 passed.
- Canonical disposable PostgreSQL mixed-row dry-run:
  `PAPERDECK_RUN_EMBEDDING_DB_INTEGRATION=true python3 -m unittest
  tests.python.test_embed_papers_database`: 2 passed.
- The disposable-database retrieval fixture confirmed that
  `match_papers_by_embedding` returns the newly embedded current-model paper and
  excludes the otherwise identical old-model paper (and vice versa when the
  explicit filter changes).
- `git diff --check`
- `scripts/pd-final-check`: passed (`diff-check`, typecheck, lint, unit).
