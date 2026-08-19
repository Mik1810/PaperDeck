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
- honors `Retry-After` and uses minute-scale exponential backoff with jitter when arXiv rate-limits shared runner IPs;
- imports descriptive metadata only: title, abstract, authors, identifiers, categories, timestamps, and external links;
- links to arXiv abstract/PDF URLs instead of copying or serving PDFs;
- upserts papers by normalized `arxiv_id`;
- deduplicates papers by normalized `arxiv_id` when the same paper appears in multiple selected categories;
- commits the paper, versioned external ID, ordered authors, and arXiv category links in one atomic database RPC;
- retries transient database failures for the entire paper bundle, never a partial sub-operation;
- writes paper bundles with bounded database concurrency (4 by default) while all arXiv requests remain behind one serialized rate gate;
- tracks independent new-publication and `updated` revision cursors per arXiv category, so new versions of old papers are refreshed;
- records runs in `ingestion_runs`.

The implementation lives in [`scripts/ingest-arxiv.ts`](../scripts/ingest-arxiv.ts).

## Local Run

Required environment variables:

```env
NEXT_PUBLIC_SUPABASE_URL=https://replace-me.supabase.co
SUPABASE_SERVICE_ROLE_KEY=replace_me
ARXIV_CATEGORIES=cs.AI,cs.CL,cs.CR,cs.CC,cs.DS,cs.LG,cs.LO,cs.PL,cs.SE,cs.SY
ARXIV_MAX_RESULTS=25
ARXIV_DATABASE_CONCURRENCY=4
ARXIV_REVISION_SWEEP=true
ARXIV_REVISION_PAGES=10
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
revision_sweep
```

When `dry_run=true`, the workflow passes `--dry-run` to `npm run ingest:arxiv`.

GitHub-hosted runners use shared outbound IPs, so arXiv may return `429` even
for the first request in a run. The worker treats `429` differently from
short-lived `5xx` failures and the workflow summary reports whether a failure
came from arXiv rate limiting, arXiv upstream availability, Supabase
authentication, or another ingestion stage. Jina is only used by the separate
paper-summary workflow and cannot cause metadata ingestion to fail.

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
ARXIV_DATABASE_CONCURRENCY
ARXIV_REVISION_SWEEP
ARXIV_REVISION_PAGES
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

## Automatic Classic Paper Discovery

PaperDeck can discover older high-impact papers automatically through Semantic Scholar citation-ranked search:

```bash
npm run discover:classics
```

It:

- runs described CS area profiles backed by focused Semantic Scholar query seeds;
- asks Semantic Scholar for pre-2021 candidates sorted by `citationCount:desc`;
- applies per-profile title guards so broad citation search does not import off-topic papers;
- inserts missing papers or updates matching `semantic_scholar_id`, `arxiv_id`, DOI, or normalized-title fallback rows;
- marks imported and matched rows with `is_classic = true`;
- links authors, curated CS topics, and external IDs;
- commits each paper, its external IDs, ordered authors, and curated topics in one service-role-only database RPC;
- retries transient database failures for the complete paper bundle, so a failed author or topic write leaves the prior paper state unchanged;
- supports `--dry-run`, `--per-query=N`, `--max-new-per-query=N`, `--max-year=YYYY`, `--categories=cs.DB,cs.OS`, and `--only="query seed text"`. `--per-query` caps accepted candidates after title/citation/year guardrails.

The category descriptions live with the arXiv category labels, while the classic discovery worker maps selected categories to query seeds and title guards. For example, `cs.OS` is represented by an operating-systems description plus seeds for Unix, kernels, virtual memory, and file systems. The category code remains the internal topic identifier; the description is what keeps the search profiles understandable and maintainable.

For a non-writing smoke test:

```bash
npm run discover:classics -- --dry-run --per-query=3 --max-new-per-query=1
npm run discover:classics -- --dry-run --categories=cs.DB,cs.OS --per-query=5
```

The worker is intentionally conservative: use small caps first, inspect dry-run output, then run write mode.

The scheduled workflow is:

```text
.github/workflows/discover-classics.yml
```

It runs monthly and can also be started manually with `workflow_dispatch`. Scheduled runs use conservative defaults (`per_query=5`, `max_new_per_query=1`, `max_year=2020`) and then embed newly eligible topic and paper vectors with MiniLM so imported classics are immediately available to semantic retrieval. Manual dispatch supports `dry_run=true` for candidate inspection and `categories` for comma-separated area/category filters.

The scheduled arXiv worker remains incremental and only imports new arXiv papers. Older classic/high-impact records enter through the separate discovery worker, not through a committed JSON seed.

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

Each successful run updates the publication cursor to the newest `publishedAt`
timestamp seen for that category. Subsequent runs import only papers newer than
that cursor. `ARXIV_MAX_RESULTS` is applied per category.

Normal runs also query each category by arXiv `lastUpdatedDate`. The independent
revision cursor is:

```text
arxiv_revisions:<category>
```

The `(updatedAt, arxivId)` pair is the revision checkpoint, including a stable
tie-breaker for papers updated at the same time. The first sweep initializes
from one newest page; later sweeps paginate until they reach that checkpoint.
Use `--no-revision-sweep` for an exceptional one-off run, or configure
`ARXIV_REVISION_SWEEP=false`.

`ARXIV_REVISION_PAGES` is the baseline work budget, not a fatal cutoff. If a
sweep cannot reach its stored cursor within that budget, the run still imports
the fetched revisions and all new publications, preserves the revision cursor,
and records the scanned depth in `cursor_value`. The next run rescans the
already covered prefix for correctness and doubles the page budget until it
reaches the cursor (10, 20, 40 pages, and so on, capped at 500). Once caught
up, the cursor advances to the newest revision and the saved depth is cleared.
The workflow summary reports categories that remain in catch-up. Reaching the
500-page safety limit emits a GitHub warning for operator review while keeping
new-publication ingestion available and the revision cursor unchanged.

Database persistence is deliberately independent from network pacing.
`ARXIV_DATABASE_CONCURRENCY` controls the bounded RPC worker pool (1-16), but a
single shared gate keeps all arXiv requests and retries at least three seconds
apart. Each paper requires one application-to-database RPC instead of a chain
of paper, external-ID, author, and topic writes.

References:

- <https://info.arxiv.org/help/api/user-manual.html>
- <https://info.arxiv.org/help/api/tou.html>

## Semantic Scholar Enrichment

All three external-enrichment workers use `paper_enrichment_outcomes` as their
durable work state. `found`, `not_found`, and `not_oa` are terminal; an operator
can deliberately recheck one by deleting that provider/paper state row.
`retryable_error` starts with a one-hour delay, doubles after each failed
attempt, and is capped at 24 hours. Candidate scans page past terminal outcomes,
so more than `limit` provider misses cannot starve later first-time papers. The
scan uses the descending `(ingested_at, id)` keyset rather than an increasingly
expensive offset.

The JSON summaries expose both provider HTTP requests and paper lookups, plus
lookups per newly terminal outcome. Cursors are updated after every persisted
batch/paper and identify the last processed candidate; `imported_count` remains
the cumulative positive-enrichment count. `--dry-run` reports classifications
and request counts but intentionally persists neither outcomes nor cursors.

The enrichment worker adds citation counts, venue corrections, DOIs, and external IDs from Semantic Scholar:

```bash
npm run enrich:semantic-scholar
```

It:

- finds arXiv papers without a `semantic_scholar_id`;
- looks them up via the S2 batch API (`/graph/v1/paper/batch`) using `ArXiv:<id>` identifiers;
- records successful and not-found outcomes per paper so permanent misses do not
  consume the bounded newest-first window again;
- retries only provider/network failures after the shared bounded backoff;
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
- records successful and not-found outcomes per paper and defers retryable
  provider failures through the shared backoff;
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
- records 404 responses as `not_found`, valid closed responses as `not_oa`,
  successful links as `found`, and transient failures as retryable;
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
Result: 21 OA links found from 29 DOI-backed papers (initial run; ROADMAP notes 24 after subsequent enrichment)
OA URLs stored in paper_external_ids (provider: unpaywall_oa)
```

## LLM Triage Summaries

The summary worker generates structured triage summaries for papers using a
configured LLM provider. Gemini is the default provider for GitHub Actions;
Cloudflare Workers AI and OpenAI remain available as fallbacks:

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

Gemini uses native JSON structured output with a schema for the four triage
fields. The scheduled workflow defaults to the stable `gemini-3.5-flash`
model, minimal thinking, and a 2,400-token output budget. The workflow fails
when every attempted summary fails, while still preserving its structured
result in the job summary. GitHub Models support remains in the worker only as
legacy code; the service was retired on July 30, 2026 and must not be selected.

Configuration:

```env
LLM_PROVIDER=gemini
LLM_MODEL=gemini-3.5-flash
LLM_API_KEY=replace_me
LLM_BATCH_SIZE=1
LLM_LIMIT=3
LLM_REQUEST_DELAY_MS=10000
LLM_RETRIES=5
LLM_SOURCE_TEXT_CHARS=8000
LLM_MAX_INPUT_CHARS=500000
LLM_MAX_OUTPUT_TOKENS=2400
JINA_API_KEY=
```

For Cloudflare Workers AI fallback:

```env
LLM_PROVIDER=cloudflare
LLM_MODEL=@cf/zai-org/glm-4.7-flash
CLOUDFLARE_ACCOUNT_ID=replace_me
CLOUDFLARE_API_TOKEN=replace_me
```

For OpenAI fallback:

```env
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=replace_me
```

For a non-writing dry-run:

```bash
npm run generate:summaries -- --dry-run --limit=5
```

Dry-runs report the number of papers needing summaries without calling the LLM API.

For a small Gemini write test:

```bash
npm run generate:summaries -- --provider=gemini --limit=2 --batch-size=1
```

Required GitHub repository secrets/permissions for the scheduled summary workflow:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
LLM_API_KEY
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

- Keep the automatic classic discovery caps small and topic-balanced so classic/high-impact papers remain a capped discovery slice, not the whole feed.
- Prefer category descriptions plus focused query seeds over raw `cs.*` codes when expanding classic discovery coverage.
- Keep the scheduled MiniLM embedding workflow healthy after ingestion, following [`docs/embeddings.md`](./embeddings.md).

## See also

- [Summaries storage strategy](./summaries.md) — JSONB inline vs separate table, scaling triggers, and migration plan.
