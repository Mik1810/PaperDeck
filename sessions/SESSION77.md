# SESSION77

## Scope

GitHub issue #168: prevent stale user-profile embedding writes when rapid
ranking mutations start overlapping refreshes.

## Decisions

- Ranking inputs use a monotonic per-profile generation instead of relying on
  process-local ordering.
- Interests, favorites, paper interactions, and Read later membership changes
  advance the generation through lightweight PostgreSQL triggers.
- A refresh reads one generation, builds the complete weighted profile, and
  may update or remove the stored embedding only while that generation remains
  current.
- The conditional write locks the profile row, closing the race with a
  concurrently committing input mutation.
- Same-instance requests share an in-flight queue with at most one trailing
  refresh; database generation checks remain the cross-instance guarantee.
- Onboarding and settings use the complete refresh path instead of a separate
  topic-only writer.

## Changes

- Added `profiles.embedding_input_generation` and
  `user_profile_embeddings.input_generation` with mutation triggers.
- Added bounded retry and per-owner refresh coalescing utilities.
- Replaced unconditional embedding upserts/deletes with generation-guarded SQL.
- Added unit coverage for superseded retries and coalescing, plus local Docker
  E2E coverage for trigger scope and a two-connection stale-write race.
- Updated the embedding architecture documentation and roadmap.

## Safety

The migration was created with the Supabase CLI and applied only to the
disposable local Docker test database. No hosted database, credential, user,
or production data was read or changed.

## Validation

- `npm run db:test:prepare`: passed, 28 ordered migrations applied.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test:unit`: 137 passed.
- `npm run build`: passed.
- Targeted local Docker E2E: 2 passed, including an uncommitted concurrent
  mutation that blocks and then rejects the stale embedding write.
- Full Playwright desktop/mobile: 84 passed and 6 expected Clerk-auth skips.
