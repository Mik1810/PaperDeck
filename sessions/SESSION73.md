# Session 73

## Scope

- Investigate the Supabase egress cost of live feed regeneration.
- Preserve semantic/catalog fallback quality without reading the complete paper
  catalog on each fallback.

## Why the full-catalog path existed

- `getAllPapers()` was introduced when the persisted MVP catalog contained four
  papers, where loading and ranking everything in application memory was
  reasonable.
- The original Supabase projection excluded embedding and summary data from
  catalog-wide reads. The Drizzle migration replaced it with unqualified
  `select()` calls, silently widening the payload to every paper column.
- The feed later grew to a 50-paper batch, and the anti-starvation correction
  intentionally invoked the catalog fallback whenever 100 semantic matches
  yielded fewer than 50 unseen papers. This fixed repeated/short decks but made
  the old unbounded query frequent.

## Implementation

- Removed the live feed's `getAllPapers()` path.
- Added explicit presentation projections for paper, author, and topic reads so
  ordinary application requests do not transfer embeddings or ingestion
  metadata.
- Changed semantic retrieval to return paper IDs and scores before hydration.
- Added a bounded catalog candidate query with a 300-paper limit. Personalized,
  recent, cited, and classic branches use `UNION ALL`, then deduplicate before
  returning only ranking fields and topic IDs.
- Reused the ranker's topic and feedback multipliers during SQL preselection;
  the definitive, versioned ranking remains in TypeScript.
- Loaded lightweight helper candidates for interactions with a non-zero ranking
  weight, fixing the previous behavior where feedback from an interacted paper
  was ignored unless that paper happened to be in the current candidate set.
- Hydrated authors, abstracts, summaries, URLs, and display topics only for the
  final 50 ranked papers.
- During full mobile validation, an instant Open then Back exposed a browser
  page-cache race in the existing optimistic dismissal. The feed now consumes
  the session marker on `pageshow`, including BFCache restoration, instead of
  relying only on a React mount effect.

## Read-only measurements

- Snapshot catalog: 3,261 papers, 14,339 author rows, 5,800 paper-topic links.
- Previous fallback shape: approximately 18 MB of paper JSON-equivalent data,
  2.5 MB of authors, and 1.9 MB of topic joins per regeneration.
- Representative two-phase shape: approximately 31 KB of 300 candidate
  descriptors, 55 KB of candidate topic links, and 225 KB for presentation,
  authors, and topics of 50 final papers.
- The weighted candidate query returned 300 candidates in about 14 ms locally.
  `EXPLAIN ANALYZE` on the snapshot completed the representative query in about
  8 ms, so no new index was justified at the current catalog size.
- Across eight broad root-topic scenarios, every reference top-50 paper from
  the former all-catalog rank was present in the bounded candidate pool and the
  score at the top-50 cutoff was unchanged. Equal-score paper ordering may
  differ because the former database ordering was not deterministic for ties.

## Safety

- No remote database row, Supabase setting, user, session, or credential was
  read or modified during implementation and validation.
- All database probes used the catalog-only local snapshot or the disposable
  synthetic Playwright database and reported aggregate values only.

## Validation

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test:unit`: 127/127 passed at the implementation checkpoint.
- Targeted `/feed` Playwright smoke: 10/10 passed across desktop and mobile at
  the first end-to-end checkpoint.
- Both deterministic recommendation quality gates passed, including the
  challenging non-perfect baseline.
- Service-role boundary audit, final typecheck, lint, and production build
  passed.
- The Open then Back regression passed ten consecutive targeted runs across
  desktop and mobile after the final synchronous marker consumption change.
- Final full Playwright suite: 74 passed and 6 expected Clerk-live skips across
  desktop and mobile.
