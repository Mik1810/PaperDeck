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
- refreshes authors and topic links for each imported paper;
- records runs in `ingestion_runs`.

The implementation lives in [`scripts/ingest-arxiv.ts`](../scripts/ingest-arxiv.ts).

## Local Run

Required environment variables:

```env
NEXT_PUBLIC_SUPABASE_URL=https://replace-me.supabase.co
SUPABASE_SERVICE_ROLE_KEY=replace_me_server_only
ARXIV_CATEGORIES=cs.AI,cs.CL,cs.CR,cs.CC,cs.DS,cs.LG,cs.LO,cs.PL,cs.SE,cs.SY
ARXIV_MAX_RESULTS=25
ARXIV_USER_AGENT=PaperDeck/0.0.0 (https://paperdeck.example.com)
```

For a non-writing smoke test:

```bash
npm run ingest:arxiv -- --dry-run --categories=cs.CC --max-results=1
```

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

References:

- <https://info.arxiv.org/help/api/user-manual.html>
- <https://info.arxiv.org/help/api/tou.html>

## Next Ingestion Work

- Add Semantic Scholar enrichment for citations and external URLs.
- Add OpenAlex enrichment for DOI, venue, open-access status, and topics.
- Add BGE-small embedding generation outside Vercel.
- Add resumable cursors per category instead of always importing the newest slice.
