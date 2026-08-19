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
- After the issue plan is approved, use a dedicated issue branch when implementation requires changes.
- Do **not** use the `codex/` prefix for branches. Prefer names such as `issue-173-notification-polling`.
- Never stash, move, commit, discard, or overwrite unrelated user changes merely to make the tree clean.

## Work discipline

For a GitHub issue, prefer a fresh Codex task/thread and use the `paperdeck-issue` skill.

Before implementation:
1. Inspect the issue and relevant current code.
2. Use read-only discovery to produce a compact plan covering goal/root cause,
   proposed changes, explicit approved mutation surfaces, meaningful
   risks/decisions, and validation.
3. End that plan with `PLAN_STATUS: AWAITING_APPROVAL` and stop. Do not create or
   switch branches, edit files, run migrations, change hosted state, commit, push,
   or publish before the user approves the plan, unless the original request
   explicitly waived the approval gate.
4. Treat a direct `ok` / `vai` / `fallo` / `procedi` / `approvato` immediately
   after the plan as approval. If the user revises scope or asks a question,
   revise the plan and wait for approval again.
5. Planning approval does not replace separate explicit approval required for
   Production/hosted schema, data, configuration, destructive, or similarly
   consequential changes.
6. Keep the implementation scoped to the approved issue plan and its explicit
   mutation surfaces. Before the first edit outside those surfaces, stop and
   request approval for a revised plan. If validation exposes a new runtime or
   product defect outside the approved goal, stop before fixing it even if the
   fix is needed to make the current issue green. New migrations, hosted
   mutations, material architecture decisions, and materially different risk
   profiles also require re-approval. Treat privilege-boundary and materially new
   transaction/locking changes as material even inside an approved surface: this
   includes `SECURITY DEFINER`/`SECURITY INVOKER`, grants/revokes, RLS/role bypass,
   ownership/search-path privilege changes, and new transaction/locking strategy.
   If the approved plan did not explicitly name that decision/risk, stop before
   the change and request revised approval.

During implementation:
- Search before opening large files.
- Read targeted regions; do not dump entire logs/documents when a smaller slice answers the question.
- Preserve unrelated user changes.
- Prefer deterministic local tools for discovery; use model reasoning for decisions and synthesis.
- Run targeted checks while iterating; broader checks once near completion when justified.
- Use `scripts/pd-run` for noisy commands.
- Never bypass a compact `pd-run` failure by dumping the raw log; use `scripts/pd-log`.
- For commands expected to run longer than a couple seconds, use about 30 seconds for the initial tool yield and about 30 seconds for subsequent waits. Do not request longer waits merely to reduce model turns; the observed terminal runtime can split them into extra inference cycles. Do not poll every 1–5 seconds.
- When a long-running process is still active and produced no actionable new output, immediately issue the next wait; do not reopen reasoning, status discovery, or commentary merely to decide to keep waiting.
- If remote CI itself is explicit acceptance evidence, prefer a non-blocking handoff: publish the known commit/PR, stop at `WAITING_FOR_CI`, and inspect the known run once on a later same-issue follow-up. Only block-watch when the user explicitly asks to wait in the current turn.
- Do not create a large local browser/container/system-package download solely to predict runner-specific CI timing. Use deterministic static/local checks first and let GitHub Actions provide runner-specific evidence unless local reproduction is itself required.
- Do not inspect `~/.codex/memories/MEMORY.md` for normal issue work; repository state and `PROJECT_STATE.md` are the issue sources of truth.

Documentation:
- Update `ROADMAP.md` only for durable product/architecture decisions.
- Update `CHANGELOG.md` only for notable changes.
- Create/update one `sessions/SESSIONi.md` summary near the end of meaningful work.
- After completing a GitHub issue, post one concise Markdown summary with validation and next steps.

Validation:
- Choose the narrowest relevant command from `package.json`.
- Do not repeatedly run the entire suite when targeted evidence is sufficient.
- If `.github/workflows/*.yml` or `.yaml` changed, run `scripts/pd-workflow-check` before the final baseline gate. It syntax-checks bash/default `run:` blocks with `bash -n` and runs `actionlint` when already installed; do not download `actionlint` merely for this check.
- For CI failures, use `gh pr checks` or `gh pr view --json statusCheckRollup` to identify the failed job, then fetch only failed-step/focused log context. Do not use unsupported `gh pr checks --json` and do not dump full workflow logs when a small error slice is enough.
- Complete the issue-scoped design/risk review, final diff review, feature-specific validation, and documentation **before** `scripts/pd-final-check`.
- Treat a passing `scripts/pd-final-check` as the final repository baseline gate. After it passes, proceed to commit/publication; do not reopen broad discovery or architecture investigation unless a concrete defect is discovered. If code changes after the gate, rerun the affected targeted check and `pd-final-check` once.
- Before finalizing, prefer `scripts/pd-final-check` to batch `git diff --check`, typecheck, lint, and unit tests into one compact tool round-trip; add `--build` when a production build is warranted.
- For frontend work, verify the affected responsive/mobile flow when the local environment supports it.
- Consult the `paperdeck_local_e2e_db` result from the initial `context.sh` output before loading browser skills or inspecting the E2E harness. If it is `blocked`, do not spend context on Docker/Playwright/browser setup unless the issue itself concerns that infrastructure or browser execution is an explicit acceptance requirement.
- When E2E is blocked by the preflight, record the blocker once and rely on the narrowest existing targeted evidence plus `pd-final-check`; do not invent brittle fallback tests merely to compensate for an unavailable environment.
- Consult `paperdeck_local_db_prereq` before database integration/performance validation that depends on the canonical disposable PaperDeck database. If it is `blocked`, do not probe system PostgreSQL, alternate ports, local users/clusters, Podman/nerdctl, or ad-hoc substitute databases unless the issue itself is about that infrastructure.
- When `context.sh` reports `paperdeck_test_db_endpoint`, use that current Docker-published endpoint instead of assuming the documented default port. Never print the full URL or credentials merely to discover the endpoint.
- Run **every database-writing integration/test/benchmark command through `scripts/pd-db-run`**. Do not build ad-hoc `DATABASE_URL` wrappers, inherit a hosted `DATABASE_URL` from `.env.local`, `source` `.env.local`, or bypass the guard after it refuses a target. Read-only DB inspection that cannot mutate is exempt.
- If an accidental Production/hosted mutation occurs, freeze all further hosted writes immediately. Perform only the minimum read-only impact assessment, report the affected objects and proposed remediation, end with `INCIDENT_STATUS: AWAITING_REMEDIATION_APPROVAL`, and stop. Cleanup/rollback/compensating writes require fresh explicit approval; never auto-remediate an accidental hosted mutation.
- When the canonical local database is blocked, record the blocker once. You may still prepare deterministic benchmark/test code, but if measured database evidence is an explicit acceptance requirement, stop before publication rather than substituting unrelated local infrastructure or inventing measurements.
- After the final issue commit, prefer one `scripts/pd-publish <issue> --summary-file -` call instead of separate `git push`, `gh pr create`, `gh issue comment`, status, and merge calls.
- Feed `pd-publish` one concise Markdown summary (implementation + validation). It reuses that summary for the PR and final issue comment, adds `Closes #<issue>`, pushes the explicit issue branch, and emits a compact terminal status.
- `PUBLISH: MERGED` and `PUBLISH: AUTO_MERGE_ENABLED` are terminal success states for the task. `PUBLISH: WAITING_*` or `PUBLISH: BLOCKED_*` must be reported precisely without CI polling.
- Never treat zero observed checks as successful CI. Merge immediately only after all observed checks are terminal pass/skipping and the PR is mergeable with no blocking review.
- Pending CI may enable auto-merge only when at least one pending check is actually required; otherwise stop rather than risk merging while optional/unprotected CI is still running.
- Never bypass failed checks, conflicts, branch protection, blocking reviews, or the publish helper's branch/worktree guards.

Task lifecycle:
- Once an issue reaches a terminal publication state (`MERGED`, `AUTO_MERGE_ENABLED`, `WAITING_*`, or `BLOCKED_*`) or is otherwise reported complete, treat that issue task as closed for new work.
- If the user then asks for a materially different issue, bug, or quick fix, do not start discovery, branch changes, edits, or publication in the same task. Give a compact handoff and require a fresh Codex task/thread for the new work.
- A same-issue follow-up such as checking a finished CI run, addressing review feedback, or completing an explicitly requested merge may continue in the current task. Reuse the established issue context; do not reread `SKILL.md`, rerun `context.sh`, or reread `PROJECT_STATE.md` unless repository state changed enough to require re-establishing context.

## Next.js repository rule

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
