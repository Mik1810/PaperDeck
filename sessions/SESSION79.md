# SESSION79

## Scope

GitHub issue #169: keep papers already consumed or rejected out of the feed
after their interaction rows fall outside the bounded ranking-history window.

## Product decisions

- Opening a paper permanently excludes it from future feed recommendations but
  does not mark it as read.
- `open_detail`, `dismiss`, `not_interested`, `read`, and `already_read` are
  durable feed exclusions.
- Favorites and membership in any private playlist are current-state
  exclusions. Removing the collection membership makes a paper eligible again
  unless a durable exclusion also exists.
- `favorite` and `save_to_playlist` interaction events remain analytics and
  ranking history, not permanent exclusion state.

## Implementation

- Added the owner-scoped `user_paper_feed_exclusions` table with a composite
  primary key, indexed paper foreign key, cause constraint, RLS, and restricted
  grants.
- Added a security-invoker trigger that atomically upserts durable state when a
  qualifying interaction is inserted.
- Added a migration backfill that retains only the latest durable action for
  each existing owner-paper pair without modifying interaction history.
- Kept recent interaction loading bounded at 200 rows for ranking while loading
  durable exclusions independently.
- Replaced the Read later-only collection query with one query across all
  private playlists, preserving a separate default-playlist set for bookmark
  presentation.
- Added desktop/mobile regression coverage proving an opened paper remains
  excluded after 201 later interactions and a custom-playlist paper becomes
  eligible again after removal.

## Safety

The migration has been applied only to the disposable local Docker database.
A hosted read-only audit confirmed that it is not applied and that the backfill
would create 367 derived owner-paper rows; no identifiers or individual actions
were read or reported. No hosted schema or production data has been changed.
Hosted rollout remains pending a migration dry-run and explicit approval.

## Validation

- `npm run db:test:prepare`: passed with 30 ordered migrations.
- `npm run typecheck`: passed.
- Unit suite after the first implementation pass: 138 passed.
- Targeted feed-exclusion E2E: 2 passed on Chromium and mobile Chrome.
- Full `npm run lint`, `npm run typecheck`, and `npm run build`: passed.
- Full `npm run test:unit`: 138 passed.
- Full `npm run test:e2e`: 91 passed, 7 skipped.
- Migration replay: latest-action backfill, security-invoker function, RLS, and
  cross-owner visibility passed inside a rolled-back local transaction.
- Supabase `db lint` could not run because the dedicated PaperDeck PostgreSQL
  image does not include the optional `plpgsql_check` extension; direct schema,
  privilege, query-plan, migration, and runtime checks passed instead.
