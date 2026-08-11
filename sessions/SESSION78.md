# SESSION78

## Scope

GitHub issue #171: remove papers from the semantic user profile when their
ranking-relevant collection state is removed.

## Decisions

- Favorites and current membership in any private playlist are authoritative
  collection signals.
- A paper saved in multiple playlists receives the playlist weight only once.
- Append-only `favorite` and `save_to_playlist` events remain analytics data
  but do not duplicate or preserve collection weight after removal.
- Behavioral interactions such as open, read, dismiss, and not interested keep
  their existing bounded history weights.
- Dirty stored embeddings are never used for semantic retrieval; the feed uses
  its non-semantic fallback until a refresh reaches the current generation.

## Changes

- Extended profile-generation invalidation from Read later to all private
  playlist memberships.
- Added a one-time generation increment for profiles with an existing embedding
  so vectors built with the previous collection weighting cannot remain usable.
- Moved background refresh scheduling into the mutation repository paths for
  interactions, Favorites, playlist membership, and playlist deletion.
- Deduplicated playlist paper inputs and excluded collection-history events
  from profile aggregation.
- Added generation matching to semantic profile retrieval.
- Added unit, migration, and browser regression coverage for custom-playlist
  removal and removal of the paper from the regenerated input signature.

## Safety

The new migration was created through the Supabase CLI and applied only to the
disposable local Docker test database. Its eventual hosted execution will
increment the generation of profiles that already have an embedding, without
deleting user or application data. A hosted read-only audit counted 144
affected profiles and confirmed that the migration is not applied; no user
identifiers, embeddings, credentials, or personal data were read or reported.
Hosted migration remains pending explicit approval.

## Validation

- `npm run db:test:prepare`: passed, 29 ordered migrations applied.
- `npm run typecheck`: passed.
- Targeted profile-embedding unit tests: 11 passed.
- Targeted Chromium mutation and generation E2E: 20 passed.
- `npm run lint`: passed.
- `npm run test:unit`: 139 passed.
- `npm run build`: passed.
- Full `npm run test:e2e`: 86 passed, 7 skipped, with one unrelated mobile
  browser-back timing failure; the isolated retry passed on Chromium and mobile
  Chrome (2 passed).
- Targeted playlist-picker retry after making database completion explicit:
  passed on Chromium and mobile Chrome (2 passed).
- `git diff --check`: passed.
