# SESSION108

## Scope

Production rollout follow-up for issue #225 after PR #231: unblock the pending
classic-paper persistence migration without changing already-applied schema or
Production migration metadata.

## Diagnosis

- Production did not contain `20260819210000_atomic_classic_paper_persistence`
  or `public.upsert_classic_paper_bundle(jsonb)`.
- A read-only history audit found five already-applied Production versions whose
  names and SQL matched local migrations but whose local timestamps differed.
- The Supabase CLI therefore rejected the normal migration dry-run before
  applying anything.

## Implementation

- Renamed the five local migration files to the authoritative Production
  versions `20260812201925`, `20260812201945`, `20260812202000`,
  `20260812202020`, and `20260812202052`.
- Kept every migration SQL payload byte-for-byte unchanged.
- Updated the three unit tests that load those migrations by path.
- Did not repair Production migration history, replay existing migrations, or
  modify Production schema, data, or configuration during alignment.

## Validation

- Content hashes for all five renamed migrations match their original files.
- Targeted catalog-search, recommendation-retention, and atomic-arXiv unit
  tests passed (`17/17`).
- A secret-scrubbed Production `supabase db push --dry-run --skip-vault`
  succeeded and proposed exactly
  `20260819210000_atomic_classic_paper_persistence.sql`, with no seeds or roles.
- `scripts/pd-final-check` passed: diff check, typecheck, lint, and all unit
  tests.
