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
- Complete the issue-scoped design/risk review, final diff review, feature-specific validation, and documentation **before** `scripts/pd-final-check`.
- Treat a passing `scripts/pd-final-check` as the final repository baseline gate. After it passes, proceed to commit/publication; do not reopen broad discovery or architecture investigation unless a concrete defect is discovered. If code changes after the gate, rerun the affected targeted check and `pd-final-check` once.
- Before finalizing, prefer `scripts/pd-final-check` to batch `git diff --check`, typecheck, lint, and unit tests into one compact tool round-trip; add `--build` when a production build is warranted.
- For frontend work, verify the affected responsive/mobile flow when the local environment supports it.
- Consult the `paperdeck_local_e2e_db` result from the initial `context.sh` output before loading browser skills or inspecting the E2E harness. If it is `blocked`, do not spend context on Docker/Playwright/browser setup unless the issue itself concerns that infrastructure or browser execution is an explicit acceptance requirement.
- When E2E is blocked by the preflight, record the blocker once and rely on the narrowest existing targeted evidence plus `pd-final-check`; do not invent brittle fallback tests merely to compensate for an unavailable environment.
- Consult `paperdeck_local_db_prereq` before database integration/performance validation that depends on the canonical disposable PaperDeck database. If it is `blocked`, do not probe system PostgreSQL, alternate ports, local users/clusters, Podman/nerdctl, or ad-hoc substitute databases unless the issue itself is about that infrastructure.
- When `context.sh` reports `paperdeck_test_db_endpoint`, use that current Docker-published endpoint instead of assuming the documented default port. Prefer the repository-configured test database URL when executing commands, and never print the full URL or credentials merely to discover the endpoint.
- When the canonical local database is blocked, record the blocker once. You may still prepare deterministic benchmark/test code, but if measured database evidence is an explicit acceptance requirement, stop before publication rather than substituting unrelated local infrastructure or inventing measurements.
- After the final issue commit, prefer one `scripts/pd-publish <issue> --summary-file -` call instead of separate `git push`, `gh pr create`, `gh issue comment`, status, and merge calls.
- Feed `pd-publish` one concise Markdown summary (implementation + validation). It reuses that summary for the PR and final issue comment, adds `Closes #<issue>`, pushes the explicit issue branch, and emits a compact terminal status.
- `PUBLISH: MERGED` and `PUBLISH: AUTO_MERGE_ENABLED` are terminal success states for the task. `PUBLISH: WAITING_*` or `PUBLISH: BLOCKED_*` must be reported precisely without CI polling.
- Never treat zero observed checks as successful CI. Merge immediately only after all observed checks are terminal pass/skipping and the PR is mergeable with no blocking review.
- Pending CI may enable auto-merge only when at least one pending check is actually required; otherwise stop rather than risk merging while optional/unprotected CI is still running.
- Never bypass failed checks, conflicts, branch protection, blocking reviews, or the publish helper's branch/worktree guards.

## Next.js repository rule

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
