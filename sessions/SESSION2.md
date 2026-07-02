# Session 2

Date: 2026-07-01

## Goal

Finish the production authentication and deployment setup that was still open after `SESSION1.md`.

## Starting Point

At the end of Session 1, PaperDeck had:

- a working Next.js scaffold;
- Clerk integrated in the codebase;
- Supabase schema applied;
- an initial Vercel deployment at `https://paper-deck-ecru.vercel.app/`;
- a known issue where protected routes on the public Vercel URL were still affected by Clerk development-key behavior.

## Summary

This session completed the production path for authentication and public access, then moved the MVP from static scaffold to a first usable data-backed app:

- added a custom production domain;
- configured Clerk as a production secondary application;
- completed Clerk DNS and SSL setup;
- configured Google OAuth production credentials;
- verified real Google sign-in in production;
- added Supabase-backed persistence for profiles, interests, favorites, `Read later`, interactions, and catalog reads;
- added arXiv ingestion with category cursors;
- added first feedback-aware feed ranking;
- added `Read later` removal and detail-page ranking signals;
- advanced the package version to `0.1.0`.

The current public app URL is:

```text
https://paperdeck.michaelpiccirilli.it/
```

## Work Completed

### Vercel Custom Domain

- Added `paperdeck.michaelpiccirilli.it` to the Vercel project.
- Added the required Register.it CNAME record:

```text
paperdeck.michaelpiccirilli.it -> ab16e0cbc5f8cd8f.vercel-dns-017.com
```

- Waited for Vercel to validate DNS and issue the HTTPS certificate.
- Verified that `https://paperdeck.michaelpiccirilli.it/` responds and redirects to `/feed`.

### Clerk Production Instance

- Created/configured a Clerk production instance for PaperDeck.
- Chose **Secondary application** because `michaelpiccirilli.it` is already used for a personal portfolio.
- Configured Clerk for:

```text
Application: paperdeck.michaelpiccirilli.it
Frontend API: clerk.paperdeck.michaelpiccirilli.it
Account portal: accounts.paperdeck.michaelpiccirilli.it
```

- Added Clerk live keys to local `.env.local` and to Vercel Production environment variables.
- Verified the deployed app serves `pk_live_...` instead of `pk_test_...`.

### Clerk DNS And SSL

- Added and verified all Clerk production DNS records on Register.it:

```text
clerk.paperdeck.michaelpiccirilli.it -> frontend-api.clerk.services
accounts.paperdeck.michaelpiccirilli.it -> accounts.clerk.services
clkmail.paperdeck.michaelpiccirilli.it -> Clerk mail service
clk._domainkey.paperdeck.michaelpiccirilli.it -> Clerk DKIM service
clk2._domainkey.paperdeck.michaelpiccirilli.it -> Clerk DKIM service
```

- Verified Clerk DNS reached `5/5 Verified`.
- Confirmed Clerk SSL certificates were issued for Frontend API and Account portal.
- Verified the Clerk JS asset path now resolves:

```text
https://clerk.paperdeck.michaelpiccirilli.it/npm/@clerk/clerk-js@6/dist/clerk.browser.js
```

### Google OAuth Production

- Configured Google Cloud OAuth consent for the PaperDeck production login.
- Created a Google OAuth Web client named `PaperDeck Production`.
- Configured Google OAuth with:

```text
Authorized JavaScript origin:
https://paperdeck.michaelpiccirilli.it

Authorized redirect URI:
https://clerk.paperdeck.michaelpiccirilli.it/v1/oauth_callback
```

- Added the Google OAuth Client ID and Client Secret to Clerk's production Google SSO connection.
- Left Clerk Google scopes at the default/minimum values:

```text
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
```

- Verified Google login succeeds in production and redirects the signed-in user to `/onboarding`.

## Verification

Verified production routing:

```text
/        -> 307 to /feed
/sign-in -> 200
/sign-up -> 200
/feed    -> 307 to /sign-in?redirect_url=... for an unauthenticated browser request
```

Important Clerk behavior:

- Browser-like unauthenticated requests to protected routes redirect correctly to `/sign-in`.
- Plain command-line requests without browser-like headers can receive Clerk's protected-route `/404` rewrite with `session-token-and-uat-missing`. This is expected and does not indicate a missing Next.js route.

## Files Updated

- `docs/deployment.md`: current production deployment, Clerk DNS, SSL, and smoke-test details.
- `sessions/SESSION1.md`: appended production deployment follow-up notes before this dedicated Session 2 file existed.
- `docs/database.md`: Supabase ownership model, persistence layer, and MVP ranking notes.
- `docs/ingestion.md`: arXiv ingestion workflow, cursors, dry-run, and GitHub Actions secrets.
- `docs/embeddings.md`: offline embedding worker and ranked retrieval workflow specification.
- `CHANGELOG.md`: reorganized `0.0.0` vs `0.1.0` and recorded MVP foundation changes.
- `README.md`: updated the public URL, project status, current ranking state, and repository layout.
- `ROADMAP.md`: kept implementation status aligned with completed persistence, ingestion, ranking, and interaction work.
- `package.json` / `package-lock.json`: version bumped to `0.1.0`.

## Commits

- `528d85c` - Document Vercel deployment status
- `18369ad` - Prepare Clerk production configuration
- `31de106` - Document custom domain Clerk deployment
- `2ed7de1` - Document Clerk DNS certificate verification
- `7e98caf` - Document Google OAuth production verification
- `51712ff` - Add Supabase-backed MVP persistence
- `8dbd566` - Add arXiv ingestion worker
- `f1a929a` - Add incremental arXiv ingestion cursors
- `47aa084` - Add MVP feed ranking

## Current Status

Production authentication is working end to end:

- custom domain: done;
- Vercel HTTPS: done;
- Clerk production keys: done;
- Clerk DNS: done;
- Clerk SSL: done;
- Google OAuth production login: done;
- redirect after first sign-up to `/onboarding`: verified.

MVP persistence now has a first server-side implementation:

- installed `@supabase/supabase-js`;
- added a server-only Supabase service-role client;
- added Clerk session helper that maps authenticated users to `owner_id`;
- added catalog repository that seeds the initial topic/paper mock data into Supabase;
- added user-data repository for profiles, onboarding interests, favorites, `Read later`, playlist items, and user-paper interactions;
- added server actions for onboarding, dismiss, open detail, favorite, and `Read later` toggle;
- connected `/feed`, `/onboarding`, `/library`, `/settings`, and `/papers/[paperId]` to Supabase-backed data instead of static mock state;
- made the onboarding topic picker interactive and persisted via server action;
- added `src/lib/ranking/feed-ranking.ts` for MVP feed ranking from selected topics, hierarchical topic affinity, recent paper feedback, citation/year metadata, and seen-paper penalties;
- made `open_detail` hide the opened paper from the active deck so the feed advances after the user opens a paper;
- changed `Read later` from one-way save to add/remove toggle;
- added Library removal for `Read later` items;
- added detail-page `Already read` and `Not interested` actions that record ranking signals and return to the feed;
- kept `SUPABASE_SERVICE_ROLE_KEY` server-only;
- verified the catalog repository against the remote Supabase project and seeded 10 topics plus 4 starter papers.

Validation after the persistence work:

```text
npm run lint  -> passed
npm run build -> passed
Remote Supabase seed count -> 10 taxonomy topics, 4 papers
Feed ranking build verification -> passed
Read later toggle and detail signal build verification -> passed
```

arXiv ingestion now has a first working implementation:

- installed `fast-xml-parser` and `tsx`;
- added `scripts/ingest-arxiv.ts`;
- added `npm run ingest:arxiv`;
- added `.github/workflows/ingest-arxiv.yml` for daily/manual GitHub Actions import;
- added `docs/ingestion.md`;
- added arXiv worker variables to `.env.example`;
- implemented arXiv Atom parsing, normalized `arxiv_id`, author import, paper-topic linking, external IDs, and `ingestion_runs` tracking;
- added `ingestion_cursors` migration/table and incremental cursor updates per category;
- deduplicated arXiv imports by normalized `arxiv_id` across categories;
- kept the worker focused on metadata/abstract/link import and did not store PDF/full text.

Embedding/ranked retrieval workflow is now specified:

- added `docs/embeddings.md`;
- decided that Python model inference runs outside Vercel, initially through GitHub Actions or locally;
- paper embedding input is `title + abstract`, not PDF/full text;
- BGE-small outputs 384-dimensional vectors for `papers.embedding`;
- added and applied the embedding schema migration for `papers.embedding_content_hash`, `topic_embeddings`, and `user_profile_embeddings`;
- added `requirements-embeddings.txt`;
- added `scripts/embed_papers.py` with Supabase REST candidate selection and `--dry-run`;
- refactored embedding worker shared utilities into `scripts/embedding_common.py`;
- added `scripts/embed_topics.py` with Supabase REST candidate selection, `--dry-run`, and `topic_embeddings` upserts;
- added `.github/workflows/embed-papers.yml` with pip/HuggingFace caching;
- updated the embedding workflow so it embeds topic vectors before paper vectors;
- added and applied `match_papers_by_embedding` pgvector RPC;
- added `src/lib/repositories/semantic-retrieval.ts`;
- integrated `/feed` so stored user profile embeddings can provide semantic candidates, with fallback to topic/feedback ranking when no user vector exists;
- added `src/lib/repositories/user-profile-embeddings.ts`;
- `/feed` now attempts to refresh `user_profile_embeddings` from stored topic/paper vectors before semantic retrieval;
- stale user profile embeddings are cleared when the current user has no usable source vectors;
- verified dry-run candidate selection against remote Supabase: 3 candidates found in the inspected slice;
- verified topic embedding dry-run against remote Supabase: 10 topic candidates found in the inspected slice;
- ran the first real BGE-small local smoke batch through `uv run --with-requirements requirements-embeddings.txt`;
- wrote 2 topic embeddings and 1 paper embedding to remote Supabase;
- verified remote embedded rows have 384 dimensions;
- verified `match_papers_by_embedding` against the real embedded paper vector; it returned the same paper with semantic score `1.0`;
- added the offline benchmark plan for BGE-small vs E5-small-v2 vs MiniLM in `docs/embeddings.md`;
- verified remote schema: 19 public tables and 19 policies after the embedding migration;
- Vercel will perform pgvector top-K retrieval and TypeScript reranking, but will not import model dependencies.

Validation after arXiv ingestion work:

```text
npm run lint -> passed
npm run build -> passed
npm run ingest:arxiv -- --dry-run --categories=cs.CC --max-results=1 -> fetched 1
npm run ingest:arxiv -- --categories=cs.CC --max-results=2 -> imported 2
Remote Supabase count -> 6 total papers, 4 arXiv papers
Latest arXiv ingestion run -> completed, imported_count=2
Applied migration -> ingestion_cursors exists with RLS enabled
Cursor verification -> first cs.CC run imported 1, second cs.CC run imported 0
Cursor dry-run after verification -> fetched 1, importable 0
Cursor DB state after idempotent run -> imported_count=0
```

## Open Questions

1. **Clerk JWT RLS**: configurare Clerk JWT per applicare le RLS policy di Supabase lato client.
2. **Dev auth**: decidere se lo sviluppo locale deve usare le key Clerk di development o solo `PAPERDECK_DEV_AUTH`.
3. **GitHub secrets**: configurare `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` per i workflow Actions.
4. **Ingestion**: ampliare oltre lo smoke test `cs.CC`, aggiungere backfill storico.
5. **Enrichment**: arricchire paper con Semantic Scholar e OpenAlex.
6. **Embeddings**: eseguire batch completi di topic e paper embeddings, benchmark modelli.
7. **Playlist**: aggiungere playlist custom private e ordinamento manuale.
8. **Docs**: allineare ROADMAP.md con CHANGELOG.md e docs/embeddings.md.

## Next Steps (ordinati per priorità)

1. Configurare i GitHub Actions secrets per ingestion e embeddings.
2. Ampliare ingestion arXiv oltre `cs.CC` a tutte le 10 categorie CS.
3. Aggiungere backfill storico per paper arXiv meno recenti.
4. Arricchire con Semantic Scholar (citation count, venue, DOI, S2 ID).
5. Arricchire con OpenAlex (venue, open access, topic, abstract).
6. Arricchire con Unpaywall (URL open access legali).
7. Eseguire batch embeddings completi (topic + paper) con BGE-small.
8. Collegare il profilo utente al feed semantico.
9. Configurare Clerk JWT per RLS Supabase.
10. Benchmark modelli embedding (BGE-small vs E5-small-v2 vs MiniLM).

## Stato al termine della sessione

- Versione: `0.1.3`
- Database: 6 paper totali, 4 arXiv
- Ingestion: script arXiv funzionante con cursori incrementali per `cs.CC`
- Embeddings: smoke batch completato (2 topic, 1 paper)
- RLS: policy SQL preparate, non ancora attivate con Clerk JWT
- L'effettivo stato implementativo e' in CHANGELOG.md + SESSION2.md + docs/embeddings.md
