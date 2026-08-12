# Session 82

## Issue #174: lazy and paginated Library collections

### Scope and decisions

- Replaced the post-hydration all-collections preload with metadata-first
  loading and one selected collection page at a time.
- Kept client-side History API navigation so collection and edit transitions
  remain immediate and back/forward compatible without an App Router request.
- Used opaque, collection-bound keyset cursors with a 24-paper page size.
- Kept drag-and-drop ordering safe for long playlists by disabling it until all
  pages of the selected playlist have been loaded; removal remains available.
- No roadmap decision changed.

### Changes

- Library initial data now returns collection counts and playlist names without
  paper IDs for every playlist, plus only the selected collection's first page.
- `/api/library/collections` now requires one authenticated collection key and
  returns only that collection and cursor page with private no-store headers.
- Added stable keysets for playlist position/added time, Favorite creation time,
  and the latest deduplicated Ignored interaction per paper.
- Added owner-scoped order indexes for playlist items, Favorites, and Ignored
  history, with matching baseline schema, Drizzle declarations, and migration.
- The client caches fetched pages per collection, shares in-flight requests,
  retries failures, deduplicates appended papers, and performs no idle preload.
- Added a guarded local benchmark command plus cursor unit, repository
  integration, and desktop/mobile browser regressions.

### Local benchmark

The benchmark used disposable `paperdeck_test`, 20 warm runs per scenario, an
instrumented node-postgres pool for statement/returned-row counts, serialized
initial-response bytes, and Chromium precise heap measurements for the parsed
client payload.

| Scenario | Queries p50 | DB rows p50 | Response | Client cache heap | p50 | p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 papers | 7 | 23 | 3,394 B | 5,854 B | 3.35 ms | 6.06 ms |
| 100 papers | 7 | 52 | 7,951 B | 9,742 B | 3.47 ms | 4.20 ms |
| 1,000 papers | 7 | 52 | 7,953 B | 9,742 B | 4.56 ms | 5.44 ms |
| 1,000 papers + 100 custom playlists | 7 | 152 | 18,653 B | 21,342 B | 16.62 ms | 17.51 ms |

The selected-paper portion stays bounded at 24 items for 100 and 1,000-paper
collections. The many-playlist case transfers 100 additional metadata rows but
hydrates none of their paper records.

### Safety

- All data reads remain server-side, owner-scoped, authenticated, and private
  no-store. An integration regression verifies that an unowned playlist returns
  no paper data.
- Cursor fields are validated and parameterized before they reach SQL.
- Database preparation, fixtures, benchmarks, and browser checks used only the
  disposable local `paperdeck_test` database. No shared Supabase data or remote
  configuration was read or modified.

### Validation

- `npm run db:test:prepare` (baseline plus all 32 ordered migrations)
- `npm run benchmark:library` (four scenarios, 20 runs each)
- `npm run test:unit` (146 passed)
- Focused Library integration test (4 passed)
- Full `tests/e2e/mutations.spec.ts` (34 passed, desktop/mobile)
- Focused ignored-history and pagination E2E (4 passed across desktop/mobile)
- `npm run typecheck`
- `npm run lint`
- `TMPDIR=/tmp npm run build`
- `git diff --check`
