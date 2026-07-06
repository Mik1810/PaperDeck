# SESSION17

Date: 2026-07-06

## Goal

Extend PaperDeck ingestion beyond daily-new arXiv papers by adding automatic classic/high-impact paper discovery.

## Changes

- Added `scripts/discover-classic-papers.ts`, a Semantic Scholar citation-ranked discovery worker with per-topic query profiles and conservative title guards.
- Added `.github/workflows/discover-classics.yml`, a monthly/manual workflow that runs conservative classic discovery and then embeds newly eligible topics/papers when not in dry-run mode.
- Kept the classic discovery workflow on MiniLM by default instead of inheriting the legacy global `EMBEDDING_MODEL` repository variable.
- Refactored classic discovery from a flat query list into described CS areas with focused query seeds, `--categories`/`--areas` filtering, and clearer area/category run logs.
- Added normalized-title fallback deduplication after Semantic Scholar, arXiv, and DOI probes.
- Added descriptions for the `cs.*` arXiv category labels used by discovery and topic presentation.
- Added `npm run discover:classics`.
- Removed the bootstrap JSON/importer path so ongoing classic ingestion is automatic, not driven by committed seed data.
- Kept classic discovery separate from the scheduled arXiv worker, which remains incremental-new only.
- Documented the automatic discovery path in README, ingestion docs, roadmap, changelog, and `.env.example`.

## Remote Data Changes

- Ran a one-time bootstrap import against Supabase before removing the seed from the repository.
- Inserted 19 classic/high-impact papers.
- Semantic Scholar matched and enriched 15/19 records.
- Verified `papers.is_classic = true` count: 19.
- Ran MiniLM paper embedding for 25 missing/stale candidates; verified all 19 classic papers now have `embedding_model = sentence-transformers/all-MiniLM-L6-v2` and 384-dimensional vectors.

## Validation

- `npm run discover:classics -- --dry-run --per-query=3 --max-new-per-query=1 --only="transformer neural machine translation"`
- `npm run discover:classics -- --dry-run --per-query=5 --max-new-per-query=1 --only="database relational model"`
- `npm run discover:classics -- --dry-run --categories=cs.OS --per-query=3 --max-new-per-query=1`
- `npm run discover:classics -- --dry-run --categories="Operating Systems" --per-query=3 --max-new-per-query=1`
- `npm run discover:classics -- --dry-run --only="database relational model" --per-query=3 --max-new-per-query=1`
- `npm run discover:classics -- --dry-run --categories=cs.OS,cs.DB --per-query=3 --max-new-per-query=1`
- `npx tsc --noEmit`
- `npx eslint scripts/discover-classic-papers.ts`
- `npm run lint`
- `npm run test:unit`
- `git diff --check`
- `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/discover-classics.yml"); puts "yaml ok"'`
- `python3 scripts/embed_papers.py --dry-run --limit 25 --table-limit 1000`
