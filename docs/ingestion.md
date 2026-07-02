# Ingestion

PaperDeck uses a free-first ingestion path. Vercel serves the app, while batch import work runs outside Vercel.

## arXiv MVP Worker

The current arXiv worker is:

```bash
npm run ingest:arxiv
```

It:

- fetches Atom XML from the arXiv legacy API;
- respects the arXiv one-request-every-three-seconds guidance;
- imports descriptive metadata only: title, abstract, authors, identifiers, categories, timestamps, and external links;
- links to arXiv abstract/PDF URLs instead of copying or serving PDFs;
- upserts papers by normalized `arxiv_id`;
- deduplicates papers by normalized `arxiv_id` when the same paper appears in multiple selected categories;
- refreshes authors and topic links for each imported paper;
- tracks one incremental cursor per arXiv category;
- records runs in `ingestion_runs`.

The implementation lives in [`scripts/ingest-arxiv.ts`](../scripts/ingest-arxiv.ts).

## Local Run

Required environment variables:

```env
NEXT_PUBLIC_SUPABASE_URL=https://replace-me.supabase.co
SUPABASE_SERVICE_ROLE_KEY=replace_me
ARXIV_CATEGORIES=cs.AI,cs.CL,cs.CR,cs.CC,cs.DS,cs.LG,cs.LO,cs.PL,cs.SE,cs.SY
ARXIV_MAX_RESULTS=25
ARXIV_USER_AGENT=PaperDeck/0.1.0 (https://paperdeck.example.com)
```

For a non-writing smoke test:

```bash
npm run ingest:arxiv -- --dry-run --categories=cs.CC --max-results=1
```

Dry-runs read the stored category cursors and report both `fetched` and `importable` counts without writing.

For a small import:

```bash
npm run ingest:arxiv -- --categories=cs.CC --max-results=2
```

## GitHub Actions

The workflow is:

```text
.github/workflows/ingest-arxiv.yml
```

It runs daily and can also be started manually with `workflow_dispatch`.

Manual dispatch supports:

```text
categories
max_results
dry_run
```

When `dry_run=true`, the workflow passes `--dry-run` to `npm run ingest:arxiv`.

Required GitHub repository secrets:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

These secrets are configured in the GitHub repository as of 2026-07-02.

Optional GitHub repository variables:

```text
ARXIV_CATEGORIES
ARXIV_MAX_RESULTS
ARXIV_USER_AGENT
```

These variables are configured in the GitHub repository as of 2026-07-02.

Verified GitHub-hosted dry-run:

```text
Date: 2026-07-02
Run: 28576306513
Commit: e001b6d
Inputs: categories=cs.CC, max_results=1, dry_run=true
Result: success
Output: {"mode":"dry-run","categories":["cs.CC"],"fetched":1,"importable":1,"firstPaper":"2607.00315"}
```

Verified multi-category ingestion (local):

```text
Date: 2026-07-02
Dry-run: 10 categories, max_results=2 per category
Result: fetched=18, importable=14

Write run: 10 categories, max_results=3 per category
Result: imported=21, fetched=27
Duplicate arxiv_id rows: 0
Cursors: set for 9/10 categories (cs.SY had no recent papers)
```

## arXiv Backfill Mode

The worker supports historical backfill via `--backfill`:

```bash
npm run ingest:arxiv -- --backfill --categories=cs.AI --max-results=25 --backfill-pages=5
```

Backfill behavior:

- Paginates through older arXiv results using `start` offset, starting from `maxResults` (skipping the newest batch already handled by incremental ingestion).
- Each page checks existing `arxiv_id` rows in Supabase via `getExistingArxivIds()`, so previously imported papers are never re-imported.
- When all papers in a page already exist in the database, backfill stops for that category (overlap reached).
- A separate backfill cursor (`arxiv_backfill:<category>`) stores the last `start` position, allowing interrupted backfills to resume.
- The incremental cursor (`arxiv:<category>`) is never modified by backfill runs.
- Rate limit (one request every three seconds) applies between pages and between categories.

For a non-writing smoke test:

```bash
npm run ingest:arxiv -- --backfill --dry-run --categories=cs.CC --max-results=5 --backfill-pages=1
```

Verified backfill runs:

```text
Date: 2026-07-02
Run 1: --backfill --categories=cs.CC --max-results=5 --backfill-pages=1
Result: imported=4, fetched=5 (1 already existed)

Run 2: --backfill --max-results=25 --backfill-pages=2 (all 10 default categories)
Result: imported=418, fetched=450 (32 already existed)
Duplicate arxiv_id rows: 0
Total arxiv papers in DB after both runs: 447
Cursors: all 10 backfill cursors created, incremental cursors untouched
```

The worker follows the official arXiv guidance:

- use `https://export.arxiv.org/api/query`;
- request Atom XML;
- do not exceed one request every three seconds;
- use a single connection;
- link users to arXiv for e-print content instead of serving PDFs from PaperDeck.

## Cursor Model

The worker stores category cursors in `ingestion_cursors`.

For arXiv, each cursor key is:

```text
arxiv:<category>
```

Example:

```text
arxiv:cs.CC
```

Each successful run updates the cursor to the newest `publishedAt` timestamp seen for that category. Subsequent runs import only papers newer than that cursor. This keeps the daily job idempotent for the newest slice. `ARXIV_MAX_RESULTS` is applied per category.

References:

- <https://info.arxiv.org/help/api/user-manual.html>
- <https://info.arxiv.org/help/api/tou.html>

## Semantic Scholar Enrichment

The enrichment worker adds citation counts, venue corrections, DOIs, and external IDs from Semantic Scholar:

```bash
npm run enrich:semantic-scholar
```

It:

- finds arXiv papers without a `semantic_scholar_id`;
- looks them up via the S2 batch API (`/graph/v1/paper/batch`) using `ArXiv:<id>` identifiers;
- automatically retries unfound papers on subsequent runs;
- enriches `citation_count`, `semantic_scholar_id`, `venue`, `year`, `doi`, and `is_open_access`;
- stores external IDs in `paper_external_ids` (provider: `semantic_scholar`, `doi`);
- tracks progress in `ingestion_cursors` with key `semantic_scholar_enrich`;
- supports an optional `SEMANTIC_SCHOLAR_API_KEY` for higher rate limits.

Configuration:

```env
SEMANTIC_SCHOLAR_API_KEY=
S2_BATCH_SIZE=100
S2_LIMIT=500
S2_REQUEST_DELAY_MS=1100
```

For a non-writing smoke test:

```bash
npm run enrich:semantic-scholar -- --dry-run --limit=5
```

Verified enrichment run:

```text
Date: 2026-07-02
Command: enrich:semantic-scholar --limit=500
Result: enriched=273, checked=443 (170 not on S2)
Papers with S2 ID after run: 277/447
DOIs filled: 32
```

## OpenAlex Enrichment

The enrichment worker adds venues, open-access status, abstracts, and topics from OpenAlex:

```bash
npm run enrich:openalex
```

It:

- finds arXiv papers that have a DOI but no `openalex_id`;
- looks them up via the OpenAlex filter API using `filter=doi:val1|val2|...`;
- enriches `openalex_id`, `venue` (publisher venue), `is_open_access`, `access` (mapped from `oa_status`), and `doi`;
- reconstructs `abstract` from `abstract_inverted_index` when the paper has no existing abstract;
- creates `taxonomy_topics` rows for OpenAlex topics and links them via `paper_topics` with confidence scores;
- stores external IDs in `paper_external_ids` (provider: `openalex`);
- tracks progress in `ingestion_cursors` with key `openalex_enrich`.

No API key is required. Set `OPENALEX_EMAIL` for polite pool access with higher rate limits.

Configuration:

```env
OPENALEX_BATCH_SIZE=25
OPENALEX_LIMIT=500
OPENALEX_REQUEST_DELAY_MS=200
OPENALEX_EMAIL=
```

For a non-writing smoke test:

```bash
npm run enrich:openalex -- --dry-run --limit=5
```

Verified enrichment run:

```text
Date: 2026-07-02
Command: enrich:openalex --limit=100
Result: enriched=11, checked=29 (21 not found on OpenAlex)
Papers with OpenAlex ID after run: 11
OpenAlex taxonomy topics created: 28
```

## Unpaywall Enrichment

The enrichment worker finds legal open-access URLs for DOI-backed papers:

```bash
npm run enrich:unpaywall
```

It:

- finds papers with a DOI that haven't been looked up on Unpaywall yet;
- queries the Unpaywall API one DOI at a time (no batch endpoint);
- stores the best OA URL in `paper_external_ids` (provider: `unpaywall_oa`, external_id: DOI);
- prefers `url_for_pdf` over `url_for_landing_page` for the stored URL;
- sets `pdf_url` on papers that don't already have one;
- confirms and stores `is_open_access` when Unpaywall reports OA status;
- tracks progress in `ingestion_cursors` with key `unpaywall_enrich`.

**Unpaywall requires a real email address** for API access. Set `UNPAYWALL_EMAIL` in your environment.

Configuration:

```env
UNPAYWALL_LIMIT=500
UNPAYWALL_REQUEST_DELAY_MS=500
UNPAYWALL_EMAIL=your@email.com
```

For a non-writing smoke test:

```bash
UNPAYWALL_EMAIL=your@email.com npm run enrich:unpaywall -- --dry-run --limit=5
```

Verified enrichment run:

```text
Date: 2026-07-02
Command: UNPAYWALL_EMAIL=... enrich:unpaywall --limit=100
Result: 21 OA links found from 29 DOI-backed papers
OA URLs stored in paper_external_ids (provider: unpaywall_oa)
```

## LLM Triage Summaries

The summary worker generates structured triage summaries for papers using a configured LLM provider. GitHub Models is the default provider for GitHub Actions; Cloudflare Workers AI and Gemini remain available as fallbacks:

```bash
npm run generate:summaries
```

It:

- finds papers with an abstract but no existing `triage_summary`;
- fetches full-paper text from arXiv through Jina AI Reader when possible, falling back to the abstract;
- sends the title and a capped full-text excerpt to an LLM with a structured output prompt;
- generates four sections: `why_it_matters`, `main_contribution`, `prerequisites`, `read_if_you_care_about`;
- stores the result as JSONB in `papers.triage_summary` with model and generation timestamp metadata;
- the paper detail page reads pre-stored summaries — no LLM call on page load;
- tracks progress in `ingestion_cursors` with key `triage_summary_enrich`.

GitHub Models uses the built-in `GITHUB_TOKEN` in GitHub Actions and requires `permissions: models: read`. The default model is `openai/gpt-4o-mini`.

Configuration:

```env
LLM_PROVIDER=github
LLM_MODEL=openai/gpt-4o-mini
GITHUB_MODELS_TOKEN=       # local only; Actions uses GITHUB_TOKEN automatically
LLM_BATCH_SIZE=1
LLM_LIMIT=3
LLM_REQUEST_DELAY_MS=10000
LLM_RETRIES=5
LLM_SOURCE_TEXT_CHARS=8000
LLM_MAX_INPUT_CHARS=500000
LLM_MAX_OUTPUT_TOKENS=1600
JINA_API_KEY=
```

For Cloudflare Workers AI fallback:

```env
LLM_PROVIDER=cloudflare
LLM_MODEL=@cf/zai-org/glm-4.7-flash
CLOUDFLARE_ACCOUNT_ID=replace_me
CLOUDFLARE_API_TOKEN=replace_me
```

For Gemini fallback:

```env
LLM_PROVIDER=gemini
LLM_MODEL=gemini-flash-latest
LLM_API_KEY=replace_me
```

For a non-writing dry-run:

```bash
npm run generate:summaries -- --dry-run --limit=5
```

Dry-runs report the number of papers needing summaries without calling the LLM API.

For a small GitHub Models write test:

```bash
npm run generate:summaries -- --provider=github --limit=2 --batch-size=1
```

Required GitHub repository secrets/permissions for the scheduled summary workflow:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
GITHUB_TOKEN        # provided automatically by Actions
models: read        # workflow permission
```

Optional Cloudflare fallback secrets/variables:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

Optional secrets:

```text
JINA_API_KEY
LLM_API_KEY        # only for Gemini fallback
```

## Next Ingestion Work

- Run the first real BGE-small embedding batch outside Vercel, following [`docs/embeddings.md`](./embeddings.md).

## See also

- [Summaries storage strategy](./summaries.md) — JSONB inline vs separate table, scaling triggers, and migration plan.
