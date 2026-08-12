# Session 83

## Issue #175: paginate large research-group paper lists

### Scope and decisions

- Kept the existing materialized authorization root and one-statement initial
  workspace load.
- Bounded only the chronological shared-paper list to 40 visible items; group
  metadata, membership controls, notification preference, and private
  `Read later` count remain eager.
- Used an opaque `(added_at DESC, paper_id ASC)` cursor so the existing
  `research_group_paper_items_group_added_idx` supports the page order without
  `OFFSET`.
- No database schema or durable product decision changed.

### Changes

- The initial workspace query now hydrates at most 41 paper rows, exposes 40,
  and derives a next cursor only when another row exists. The exact total paper
  count remains visible in the section heading.
- `/api/groups/[groupId]/papers` requires the current user, validates the group
  and cursor, repeats the authorization-rooted group CTE, and returns private
  no-store JSON. Revoked membership or disabled reads return no paper data.
- The client appends pages on demand, shares an in-flight request, deduplicates
  paper IDs, reports retryable errors, and resets to fresh server data after a
  group revision or paper-list mutation.
- Cursor unit tests cover malformed inputs and the SQL source regression
  requires the matching keyset boundary with no `OFFSET`.
- The isolated browser fixture now contains 46 shared papers, including tied
  timestamps. Mobile verification proves a 40-item initial render and a
  complete 46-item list after one load-more request.
- The group-workspace runner now applies the immutable baseline plus every
  ordered migration, with local-only pgvector substitutions, matching the
  repository's current schema reconstruction model.

### Local benchmark

The guarded benchmark used disposable `paperdeck_test`, 20 warm repository
runs and 10 Chromium mobile navigations per scenario. It instrumented the
node-postgres statement, serialized DB result, server mapping/serialization,
initial HTML response, client-navigation RSC payload, and time until all first
page paper cards rendered. Browser timings use the development server and are
comparative evidence, not a Production SLA.

| Papers | First items | Queries p95 | SQL p95 | Next SQL p95 | DB result p95 | HTML p95 | RSC p95 | Mobile render p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 10 | 1 | 2.26 ms | n/a | 9,319 B | 82,108 B | 20,224 B | 787.58 ms |
| 100 | 40 | 1 | 3.66 ms | 3.77 ms | 36,600 B | 218,118 B | 48,738 B | 783.71 ms |
| 500 | 40 | 1 | 3.01 ms | 3.50 ms | 36,600 B | 218,118 B | 48,738 B | 792.67 ms |

The 100- and 500-paper scenarios have identical bounded first-page result,
HTML, and RSC sizes. SQL and mobile rendering p95 also remain effectively
flat instead of scaling with the full group list.

### Safety

- All new reads are authenticated, member-scoped, parameterized, and private
  no-store. Cursor contents contain only ordering fields.
- Database setup, benchmark rows, and browser fixtures were confined to
  disposable local PostgreSQL. No shared Supabase data was read or mutated and
  no Clerk session was created.

### Validation

- `npm run db:test:prepare` (baseline plus all 32 ordered migrations)
- `npm run benchmark:group-pagination` (10/100/500 paper scenarios)
- Focused research-group cursor and page-safety unit tests (6 passed)
- `npm run test:unit` (149 passed)
- `npm run test:e2e:group-workspace` (member, owner, and mobile phases)
- `npm run typecheck`
- `npm run lint`
- `TMPDIR=/tmp npm run build`
- `git diff --check`
