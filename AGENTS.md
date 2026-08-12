# PaperDeck Agent Guide

## Mission

PaperDeck is a mobile-first academic paper discovery app for computer science.
Optimize for a fast, accurate daily paper-triage loop.

## Sources of truth

Use the smallest relevant source instead of loading everything:

- `PROJECT_STATE.md`: compact durable architecture and invariants.
- `ROADMAP.md`: product and architecture decisions.
- `docs/`: feature-specific specifications.
- `CHANGELOG.md`: notable repository changes.
- `sessions/`: historical work logs; search first and read only relevant sections.
- `supabase/schema.sql` + ordered migrations: database schema history.
- `package.json`: available validation commands.

Do not preload large documents. Search first, then read only relevant sections/files.

## Core invariants

- Keep the architecture free-first; do not introduce paid services without explicit approval.
- Auth is Clerk; privileged user operations require server-side ownership/auth checks.
- Database is Supabase Postgres with pgvector; user-owned rows use Clerk user IDs in `owner_id text`.
- Never expose `.env.local` secrets or service-role credentials to browser code or logs.
- Do not put long-running ingestion, PDF parsing, or local embedding generation on Vercel Functions.
- Prefer official APIs/documented sources over scraping.
- Do not import or republish full text unless licensing clearly permits it.
- Preserve LaTeX/math notation in abstracts.
- Semantic relevance is the primary ranking objective.

## Repository workflow preferences

- Use one coherent GitHub issue/problem per Codex task/thread.
- Work in the main PaperDeck checkout; do not create separate worktrees unless the user explicitly asks.
- Assume only one active PaperDeck coding session at a time.
- Use a dedicated issue branch when implementation requires changes.
- Do **not** use the `codex/` prefix for branches. Prefer names such as `issue-173-notification-polling`.
- Never stash, move, commit, discard, or overwrite unrelated user changes merely to make the tree clean.

## Work discipline

For a GitHub issue, prefer a fresh Codex task/thread and use the `paperdeck-issue` skill.

Before implementation:
1. Inspect the issue and relevant current code.
2. State the problem, why it matters, and the attack plan briefly.
3. Keep the change scoped to the requested issue.

During implementation:
- Search before opening large files.
- Read targeted regions; do not dump entire logs/documents when a smaller slice answers the question.
- Preserve unrelated user changes.
- Prefer deterministic local tools for discovery; use model reasoning for decisions and synthesis.
- Run targeted checks while iterating; broader checks once near completion when justified.
- Use `scripts/pd-run` for noisy commands.
- Never bypass a compact `pd-run` failure by dumping the raw log; use `scripts/pd-log`.
- For commands expected to run longer than a couple seconds, use about 30 seconds of tool yield/wait. Do not poll every 1–5 seconds.
- Do not inspect `~/.codex/memories/MEMORY.md` for normal issue work; repository state and `PROJECT_STATE.md` are the issue sources of truth.

Documentation:
- Update `ROADMAP.md` only for durable product/architecture decisions.
- Update `CHANGELOG.md` only for notable changes.
- Create/update one `sessions/SESSIONi.md` summary near the end of meaningful work.
- After completing a GitHub issue, post one concise Markdown summary with validation and next steps.

Validation:
- Choose the narrowest relevant command from `package.json`.
- Do not repeatedly run the entire suite when targeted evidence is sufficient.
- Before finalizing, prefer `scripts/pd-final-check` to batch `git diff --check`, typecheck, lint, and unit tests into one compact tool round-trip; add `--build` when a production build is warranted.
- For frontend work, verify the affected responsive/mobile flow.
- Finish completed issue work end-to-end when safe: create the PR with `Closes #<issue>`, post one concise implementation/validation comment on the issue, and take one PR status snapshot.
- If the PR is non-draft, conflict-free/mergeable, has no blocking review, and all required checks are successful, merge it without asking again.
- If required checks are still pending and repository auto-merge is available, enable auto-merge instead of polling; then stop and report that merge is pending.
- Never bypass failed checks, conflicts, branch protection, or blocking reviews.
- Never watch/poll remote CI repeatedly just to reach mergeability.
- After merge, verify the issue is closed; close it explicitly only if `Closes #<issue>` did not already do so.

## Next.js repository rule

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
