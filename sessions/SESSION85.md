# Session 85

## Issue #177: read-only authenticated page renders

### Scope and decisions

- Removed profile, collaboration-identity, and default-playlist provisioning
  from authenticated page rendering.
- Kept first-account provisioning in explicit onboarding and settings
  mutations, where the user is intentionally changing state.
- Added a guarded mutation fallback for legacy or partially provisioned
  accounts. It reacts only to a known owner-to-profile foreign-key failure,
  creates the minimal profile, and retries the mutation once.
- No roadmap decision changed.

### Changes

- `/onboarding`, `/search`, and `/settings` now authenticate and read state
  without calling profile bootstrap or collaboration identity synchronization.
- Deck actions, paper feedback, interest saves, playlist creation, dismissals,
  and note creation use the guarded missing-profile fallback.
- PostgreSQL error recognition supports both the `constraint` and
  `constraint_name` fields used by the repository's database drivers, including
  wrapped causes, while unrelated foreign-key and uniqueness failures propagate.
- Added unit coverage for the read-only page boundary and error classifier,
  disposable-database integration coverage for explicit and fallback lifecycle
  paths, and desktop/mobile browser regression coverage.

### Safety and evidence

- A direct `/onboarding` GET leaves both profile and playlist tables empty;
  completing onboarding then creates exactly one profile and one default
  `Read later` playlist.
- `/search` and `/settings` preserve exact profile and playlist row snapshots,
  including PostgreSQL `xmin`, proving that renders perform neither inserts nor
  updates to those bootstrap rows.
- A real missing-profile PostgreSQL mutation retries successfully, creates one
  profile and one interaction, and does not eagerly create a playlist.
- All database fixtures were disposable and local to `paperdeck_test`; no
  shared Supabase data or remote configuration was read or modified.

### Validation

- `npm run db:test:prepare` (baseline plus all 32 ordered migrations)
- Focused read-only page unit tests (5 passed)
- Profile bootstrap lifecycle integration tests (2 passed)
- Focused onboarding and read-only render E2E (4 passed across desktop/mobile)
- `npm run test:unit` (148 passed)
- `npm run typecheck`
- `npm run lint`
- `TMPDIR=/tmp npm run build`
- `git diff --check`
