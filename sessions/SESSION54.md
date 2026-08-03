# Session 54

## Scheduled summary workflow recovery

- Audited the failing scheduled GitHub Actions runs without reading secret
  values. The summary workflow was the only recurring workflow failing.
- Confirmed that all attempted papers failed because GitHub Models returned
  HTTP 410 after the service retirement on July 30, 2026.
- Set the repository provider variable to `gemini` and ran a three-paper live
  probe. Authentication succeeded, but zero summaries were written: one answer
  ignored the JSON-only instruction and two JSON answers were truncated.
- Replaced the workflow default with stable `gemini-3.5-flash`, native
  schema-constrained JSON output, minimal thinking, and a 2,400-token output
  budget. Gemini temperature is intentionally left unset.
- Invalid model output now reports only the finish reason and token counts;
  raw malformed responses are never printed.
- GitHub Models remains selectable only as legacy worker code and is no longer
  a documented or scheduled provider.

## Validation

- Targeted summary-run unit tests: 4 passed.
- Full unit suite: 98 passed.
- Full ESLint: passed.
- TypeScript typecheck: passed.
- Production build: passed.
- `git diff --check`: passed.
- Published commit `286a32a` to `agent/fix-scheduled-summaries` and ran a
  three-paper live probe. The REST endpoint rejected lowercase
  `application/json` for the new response-format enum, so zero summaries were
  written.
- Corrected the REST value to `APPLICATION_JSON`, as required by the Gemini
  Generate Content API.
- Published follow-up commit `ff7e907` and repeated the live probe on the same
  three still-null targets. The workflow succeeded: 3 papers checked, 3
  summaries generated and written, 0 failures, and 0 existing summaries
  skipped.
