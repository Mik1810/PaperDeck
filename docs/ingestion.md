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

Required GitHub repository secrets:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

The workflow has not been run from GitHub yet. It is ready once those secrets are configured in the repository.

Optional GitHub repository variables:

```text
ARXIV_CATEGORIES
ARXIV_MAX_RESULTS
ARXIV_USER_AGENT
```

## arXiv API Limits

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

Each successful run updates the cursor to the newest `publishedAt` timestamp seen for that category. Subsequent runs import only papers newer than that cursor. This keeps the daily job idempotent for the newest slice. `ARXIV_MAX_RESULTS` is applied per category. Historical backfill still needs a separate strategy using `--start` or a future backfill mode.

References:

- <https://info.arxiv.org/help/api/user-manual.html>
- <https://info.arxiv.org/help/api/tou.html>

## Next Ingestion Work

- Add Semantic Scholar enrichment for citations and external URLs.
- Add OpenAlex enrichment for DOI, venue, open-access status, and topics.
- Run the first real BGE-small embedding batch outside Vercel, following [`docs/embeddings.md`](./embeddings.md).
- Add historical backfill mode for older arXiv pages.
