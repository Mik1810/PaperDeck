# SESSION76

## Scope

GitHub issue #167: make Favorite and Read later mutations atomic and safe to
retry after a lost or failed response.

## Decisions

- `user_paper_interactions` remains an append-only event log.
- Collection requests carry an explicit target state instead of toggle
  semantics.
- An interaction is written only for a real OFF-to-ON transition and commits
  in the same transaction as the collection state.
- Swipe right always means `Read later = ON`; Library removal always means
  `Favorite = OFF`.
- The broader consolidation and playlist-ordering refactor remains tracked by
  #180.

## Changes

- Replaced the Favorite and Read later toggle repositories with idempotent
  state setters returning `changed` and `selected`.
- Made default Read later provisioning, membership insertion and interaction
  recording one transaction.
- Required boolean `selected` state in both the client helper and deck API.
- Updated feed, paper detail, swipe and Library removal callers to send their
  actual intent.
- Removed lifetime deduplication from transactional picker interaction writes;
  a real re-add now appends a new event while a duplicate request remains a
  no-op.
- Avoided profile-embedding refresh work for idempotent no-op requests.

## Safety

No hosted database, migration, credential or user data was changed. Rollback
testing adds and removes a temporary constraint only in the guarded local E2E
database.

## Validation

- `npm run test:unit`: 134 passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- Targeted deck mutation E2E: 14/14 passed across desktop and mobile, including
  idempotent retries and forced interaction-write rollback for Favorite and
  Read later.
- Full Playwright: 80 passed and 6 expected Clerk-auth skips across desktop and
  mobile. The picker re-add scenario also verifies three append-only events for
  three real saves across the custom and default playlists.
