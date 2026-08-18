# Session 93 — Deck mutation and picker response hardening

## Goal

Complete GitHub issue #185 by failing closed on malformed successful deck
mutation responses and preventing stale playlist-option requests from replacing
newer picker state.

## Implementation

- Added an explicit Zod schema for deck mutation responses. A mutation now
  succeeds only when the HTTP response is successful and its payload contains
  `ok: true` plus the requested action; malformed, missing, or mismatched
  success payloads use the existing rollback/error path.
- Added an `AbortController` and monotonically increasing request sequence to
  playlist option loading. Closing, reopening, retrying, or unmounting the
  picker invalidates the prior request, and only the latest request may update
  items, errors, or loading state.
- Added unit regressions for malformed 2xx payloads and mismatched actions, plus
  a browser regression that delays the first picker load until after a
  close/reopen and verifies that only the second response remains visible.

## Validation

- Focused deck-mutation unit tests: 21/21 passed.
- `scripts/pd-final-check`: passed (`git diff --check`, typecheck, lint, and the
  full unit suite).
- The targeted Playwright file could not start because Docker is unavailable in
  the current WSL environment; the new browser test is typechecked and linted
  but its runtime result remains unverified locally.
