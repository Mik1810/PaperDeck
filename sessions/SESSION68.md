# Session 68

## Scope

- Finish the `/groups/[groupId]` stabilization work before considering a
  separate Transaction-pooler rollout.
- Remove the repeated authorization and catalog query fan-out from the group
  workspace without changing the visible interface, database schema, RLS,
  runtime switches, or connection configuration.

## Decision

- Keep the current Session-pooler configuration on port 5432 for local
  development and Production during this change.
- Load the visible group workspace through one page-specific PostgreSQL
  statement instead of several independent repository calls.
- Use a materialized `authorized_group` CTE rather than a heterogeneous
  `UNION`: every paper, member, preference, and private-library result is
  correlated to the one authorized group row.
- Keep the member-management panel eagerly loaded because it is currently
  visible in the page. A truly lazy member query would require a separate
  product decision to hide that panel until user interaction.

## Changes

- Added `loadResearchGroupWorkspace`, which returns group metadata, the current
  role and notification preference, chronological papers with batched JSON
  author/topic projections, public member projections, and the `Read later`
  count through one `db.execute` call.
- Materialized the limited paper-ID set once and aggregate authors/topics by
  paper in batch CTEs, avoiding per-paper correlated scans inside the single
  statement.
- Kept the active-group state, active membership, and global read switch in the
  root CTE. If it yields no row, no nested workspace or private-library data is
  returned.
- Preserved contributor detachment, role-dependent remove controls,
  deterministic ordering, and the existing 500-paper limit.
- Removed the now-unused detail-page repository readers that each repeated the
  two-query permission check.
- Generalized the existing catalog presentation mapper so both ordinary
  catalog reads and the aggregated workspace use the same paper, topic, source,
  access, and triage-summary conversion.
- Added a source regression test requiring the detail page to use the single
  workspace statement and an E2E revocation check that confirms a former member
  receives the not-found UI without group data.

## Query Shape

- Previous worst-case page path: approximately 17 SQL statements: four
  repeated two-statement permission checks, separate group/member/preference
  reads, four paper/catalog reads, and two `Read later` reads.
- Current page path: one SQL statement with a materialized authorization CTE
  plus a materialized limited-paper set and aggregate subqueries. Empty paper
  lists naturally skip author and topic scans.

## Safety

- No shared or remote database row was created, changed, or deleted.
- The browser test used only a disposable local PostgreSQL cluster and
  synthetic identities.
- No Clerk session was created and no secret or personal identifier was
  printed or written to a versioned file.
- Research-group reads remain enabled and writes remain disabled outside the
  isolated local test.

## Validation

- Targeted research-group page safety test: 3/3 passed.
- `npm run lint` passed.
- `npm run typecheck` passed after moving a pre-existing malformed generated
  `.next` cache to `/tmp` and regenerating types.
- `npm run test:unit`: 118/118 passed.
- `npm run build` passed with `/groups/[groupId]` retained as a dynamic route.
- `npm run test:e2e:group-workspace` passed for member, owner, and mobile with
  `DATABASE_MAX_CONNECTIONS=1`, zero remote mutations, and zero Clerk sessions.
- The member phase verifies that direct navigation after leaving renders the
  not-found UI and does not expose the group heading.
