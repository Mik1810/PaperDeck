# Session 27 — Issue #81: feed impression attribution

## Problem

`getFeedPageData()` generated recommendation impressions in a background
`after()` callback, then returned every `FeedPaper` with an undefined
`recommendationImpressionId`. The deck mutation client therefore omitted the
ID and the backend stored valid user interactions with null attribution.

## Changes

- Restored synchronous persistence of the visible recommendation batch as one
  multi-row insert with `RETURNING`, before rendering the feed payload.
- Attached the returned impression ID to each `FeedPaper`, preserving the
  existing same-owner/same-paper validation in `/api/deck`.
- Added batch ID, count, and measured insert duration to `feed_timing` so the
  attribution/latency trade-off remains observable.
- Replaced the E2E test's hand-built API call with a real rendered-card dismiss
  and verified that the persisted interaction references that exact impression.
- Updated embedding diagnostics documentation and the changelog.

## Validation

- Focused recommendation analytics E2E (Chromium): 2 passed.
- `npm run test:unit`: 48 passed.
- `npm run lint`, `npm run typecheck`, and `npm run build`: passed.
- `npm run test:e2e`: 52 passed; 4 Clerk-auth checks skipped without test
  credentials.

## Scope

- No schema migration: the impression table and foreign key already exist.
- The live recommendation cache remains asynchronous; only the IDs required by
  rendered cards are written before the response.
