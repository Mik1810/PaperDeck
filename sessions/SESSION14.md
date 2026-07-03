# SESSION 14

Date: 2026-07-03
Task: Normalize embedding model decision

## Issue

GitHub issue #46 tracks stale BGE-small references after the benchmark selected
`sentence-transformers/all-MiniLM-L6-v2` as the current embedding model.

## Plan

1. Make MiniLM the explicit current/default model in roadmap and embedding docs.
2. Keep BGE-small references only as historical benchmark or smoke-run context.
3. Rename the HuggingFace cache key so it is not BGE-specific.
4. Verify model defaults and remaining references before updating the issue.

## Changes

- Opened this session log for issue #46.
- Updated roadmap status and embedding strategy to make MiniLM the current model.
- Updated architecture diagrams and model table from BGE-small to MiniLM.
- Updated embedding, database, and ingestion docs so BGE-small is historical baseline context only.
- Filtered semantic retrieval to the shared current embedding model before selecting a user profile vector.
- Renamed the GitHub Actions HuggingFace cache key to a generic embedding-model cache key.
- Updated the canonical schema comment for the pgvector cosine index.
- Ran MiniLM write-mode embedding batches against Supabase: 2 topic vectors and 256 paper vectors were written.
- Verified remote embedding counts: 571 MiniLM paper rows, 66 MiniLM topic rows, and 2 MiniLM profile rows; BGE-small remains only as historical rows in multi-model tables.
- Added a changelog entry for the MiniLM documentation/cache normalization.

## Verification

- `rg` check for BGE default/current/cache patterns - only historical-baseline references remain.
- `rg` check for MiniLM defaults - Python worker, GitHub Actions workflow, schema/RPC, migration, profile repository, and docs all point to `sentence-transformers/all-MiniLM-L6-v2`.
- `python3 scripts/embed_topics.py --dry-run --limit 5 --table-limit 20` - used MiniLM and found 0 topic candidates in the inspected slice.
- `python3 scripts/embed_papers.py --dry-run --limit 5 --table-limit 20` - used MiniLM and marked inspected paper rows as `model_changed`, confirming legacy model rows are selected for re-embedding.
- `uv run --isolated --with-requirements requirements-embeddings.txt python scripts/embed_topics.py --limit 256 --table-limit 512 --batch-size 64 --quiet` - wrote 2 MiniLM topic vectors.
- `uv run --isolated --with-requirements requirements-embeddings.txt python scripts/embed_papers.py --limit 512 --table-limit 1000 --batch-size 64 --quiet` - wrote 256 MiniLM paper vectors.
- `python3 scripts/embed_topics.py --dry-run --limit 20 --table-limit 512` - 0 remaining MiniLM topic candidates.
- `python3 scripts/embed_papers.py --dry-run --limit 20 --table-limit 1000` - 0 remaining MiniLM paper candidates.
- Remote count query - 571 MiniLM paper rows, 66 MiniLM topic rows, 2 MiniLM profile rows; historical BGE-small rows remain only in multi-model topic/profile tables.
- `git diff --check` - passed.
- `npm run lint` - passed.
- `npm run test:unit` - passed.
- `npx tsc --noEmit` - passed.
- `npm run build` - passed.
