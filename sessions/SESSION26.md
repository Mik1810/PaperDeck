# Session 26 — Issue #83: `already_read` recommendation feedback

## Problem

The paper detail action records `already_read` and hides that paper from the
active deck, but the action previously had no positive weight in either the
feed reranker or user profile embedding refresh. A completed paper therefore
did not improve recommendations for related topics.

## Changes

- Added `already_read: 3` to the feed ranker's positive interaction weights,
  matching the legacy `read` action.
- Moved profile embedding interaction weights to the pure
  `PROFILE_PAPER_INTERACTION_WEIGHTS` export in
  `src/lib/profile-embedding-utils.ts`; added `already_read: 3` there and made
  the repository consume that contract.
- Added unit coverage that `already_read` boosts a related candidate in the
  reranker and has the same embedding weight as `read`.
- Documented the compatibility semantics in `docs/embeddings.md` and
  `docs/database.md`, and recorded the fix in `CHANGELOG.md`.

## Validation

- Focused ranking/profile-weight tests: 9/9 passed.
- `npm run test:unit`: 48/48 passed.
- `npm run lint`, `npm run typecheck`, and `npm run build`: passed.
- Commented and closed GitHub issue #83; verified its `completed` state and
  rendered Markdown close comment.

## Scope

- No migration or interaction enum change: both values remain supported for
  compatibility.
- No change to private data visibility, ranking inputs other than the missing
  positive signal, or unrelated working-tree changes.
