# Agent Guide

## Project Purpose

PaperDeck is a mobile-first academic paper discovery app for computer science. The MVP should help a user discover relevant papers through a social-style full-screen deck, save interesting papers, and build private reading lists.

## Current Product Decisions

- Product name: `PaperDeck`.
- Repository name: `paperdeck`.
- App language: user-facing product can start in English; planning conversation may be Italian.
- Domain: computer science only for MVP.
- Auth: Clerk with Google login.
- Auth implementation: `@clerk/nextjs`, `ClerkProvider`, and `src/proxy.ts` route protection.
- Database: Supabase Postgres with pgvector.
- Database ownership: user-owned rows store Clerk user IDs in `owner_id text`.
- Database access MVP: user-specific queries should go through server-side code until Clerk JWT and Supabase RLS are configured end to end.
- Hosting: Vercel for app and lightweight APIs.
- Worker: GitHub Actions daily schedule plus manual dispatch.
- Embeddings: `sentence-transformers/all-MiniLM-L6-v2` (selected via offline benchmark, +17% vs BGE-small).
- Ranking: semantic relevance is more important than recency or citation count.
- Feed: full-screen mobile card deck.
- Heart: favorite.
- Bookmark: save to default `Read later` playlist.

## Important Files

- `ROADMAP.md`: source of truth for product and architecture decisions.
- `README.md`: public-facing repository overview.
- `CHANGELOG.md`: short semver change history.
- `sessions` folder: Here, in each new session of work, create the SESSIONi.md where i is the next session number.
- `docs` folder for specification.
- `supabase/schema.sql`: initial schema and policy draft.

## Working Rules

- Keep changes scoped and intentional.
- After each modification, save it on the SESSIONi.md file with a brief description of the change. 
- Before starting implementation work on a GitHub issue, briefly describe the issue being addressed, why it matters, and the intended attack plan.
- Update `ROADMAP.md` when product or architecture decisions change.
- Update `CHANGELOG.md` for notable repository changes.
- Add or update a session file when a session produces meaningful decisions or implementation work.
- Do not introduce paid services unless explicitly approved.
- Keep the architecture free-first.
- Do not expose any key in `.env.local` to browser code.
- Do not put long-running ingestion, PDF parsing, or local embedding generation on Vercel Functions.
- Prefer official APIs and documented sources over scraping.
- Do not import or republish full text unless the license and source clearly allow it.
- Preserve LaTeX/math notation in abstracts and render it later with KaTeX or MathJax.
- After working on a Github issue, update the issue with a summary of what was done and any next steps in correct markdown style. Eventually, close it when the work is complete.
- Use `npm run issues:import` to batch-create issues from a Markdown file. The format is documented below.

## Issue Import Format

Create a `.md` file (e.g., in `issues/`) with `---` separated blocks. Each block has a `## Title`, an optional `labels:` line, and a markdown body:

```
---
## Issue Title Here
labels: area:security, priority:p1, type:bug

**File:** src/file.ts:123

Body content with full markdown support.

---
## Next Issue Title
labels: area:frontend, priority:p2, type:enhancement

Body content...

---
```

Usage:
- `npm run issues:import -- --file issues/my-issues.md --dry-run` to preview
- `npm run issues:import -- --file issues/my-issues.md` to create
- `--label=area:security` to add default labels to all issues
- `--verbose` / `-v` to see full issue bodies

The script also parses `### N.N Title` blocks in existing docs like `ANALYSIS.md`.
- Detects duplicate open issues by title.
- Auto-creates missing labels.

## Validation Expectations

- Run relevant tests/checks before finalizing implementation work.
- After each modification, ask yourself if the change is complete, correct, and well-documented. Then, try to simplify the change and remove any unnecessary code or complexity, or useless dependencies.
- If no tests exist yet, state that explicitly.
- For frontend work, verify responsive mobile behavior before considering the task complete.

<!-- tokenade-scaffold -->
## Explore code with the `tokenade` CLI (cheaper than reading whole files)
Use these only when you don't yet know where code lives — if you know the path, open it directly:
`tokenade map` (repo structure) · `skeleton <file…>` (signatures) · `query <symbol…>` (locate a symbol) · `impact <file…>` (dependents) · `semantic "<query>"` (search by meaning). They take MANY targets per call (`tokenade skeleton a.rs b.rs c.rs`) — batch in ONE turn.

## Compute over data with `tokenade exec`
`tokenade exec --lang python --script '<code>'` (also sh/node/ruby/awk/jq/perl) runs in a sandbox and returns ONLY its stdout. Use it to COMPUTE over data — filter/aggregate a large or structured output, pull facts across SEVERAL files, or apply one mechanical edit across many files (migration, find-replace) — in ONE script, not one command per item. It is NOT a file reader: to read content, use the parallel reads above, not `exec`. Keep scripts SHORT (aim ≤ ~20 lines): exec is for throwaway one-shot computation, not for code you will edit and iterate on — every script char is billed as output, and a long script usually means a simpler command (or a real file you Write once and run) does it cheaper. Long or quote-heavy script? `--script-file <path>` (or `--script -` on stdin) avoids shell quoting entirely.

## Commands
If you do not have hooks (i.e. you are not Claude Code or Gemini CLI), use `tokenade wrap '<cmd>'` to wrap all your commands. If there is an opportunity for compacting noisy output, tokenade will find it — and you will waste fewer tokens.
Call binaries by their PATH name, not an absolute path (`git`, not `/usr/bin/git`) — an absolute path bypasses tokenade's hook and PATH shim, so that command's output isn't compacted.

## Keep output lean
Keep prose terse and code minimal — every token you write is billed as output.
- **Prose:** answer directly — no preamble, recap, tool-call narration, summary, or emoji. Drop articles, filler (*just/really/basically/simply*) and hedging; fragments fine; short word over long.
- **Output:** don't paste long raw output — quote the shortest decisive line. No decorative tables.
- **Code:** write the least that works; reuse before adding (`query` / `skeleton` / `impact`, stdlib, platform feature — YAGNI).
- **Verbatim:** keep code, identifiers, API/CLI names and error strings exact — never abbreviate or paraphrase. Keep the user's language.
- **Correctness first:** fix root causes not symptoms, don't downgrade the algorithm, don't guess APIs/flags/versions — verify.
- **Full prose where terseness could mislead:** security/data-loss warnings, irreversible-action confirmations, multi-step sequences.
- Applies to the subagents you spawn.
<!-- /tokenade-scaffold -->
