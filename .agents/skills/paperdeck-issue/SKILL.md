---
name: paperdeck-issue
description: Work on one PaperDeck GitHub issue end-to-end with minimal context, targeted repository discovery, compact command output, focused validation, and concise documentation. Use for implementing, fixing, or investigating a specific PaperDeck issue. Do not use for broad product brainstorming or unrelated multi-issue sweeps.
---

# PaperDeck issue workflow

Treat one issue as one coherent unit of context.

This skill body is already loaded when invoked. **Do not open/read `SKILL.md` again.**

## 1. Establish context

Run:

```bash
.agents/skills/paperdeck-issue/scripts/context.sh <issue-number>
```

Then read `PROJECT_STATE.md` by itself.

Work in the current PaperDeck checkout. Do not create a separate worktree unless the user explicitly asks.

If implementation requires changes:
- after the planning gate is approved, use a dedicated issue branch;
- do not use a `codex/` branch prefix;
- if the checkout contains unrelated uncommitted changes, stop before branch-changing/stashing/discarding and report exactly what conflicts with the issue;
- never manipulate unrelated user changes merely to continue.

Inspect only relevant `ROADMAP.md`/`docs/` sections when needed.
Search before opening source files. Search historical sessions first; do not bulk-read them.
Do not query `~/.codex/memories/MEMORY.md` for normal issue work; use repository-local context.

## 2. Plan, present, and wait for approval

Before any implementation mutation, perform only enough focused **read-only**
discovery to understand the issue and propose a concrete plan. Read-only work may
include issue/repository inspection, `git status`/diff inspection, focused source
searches, existing tests/docs, and safe diagnostics justified by the issue.

Do **not** create/switch branches, edit files, run migrations, change hosted
configuration/data, commit, push, create/update a PR, or otherwise mutate local or
remote project state before this gate is approved.

Present one compact reviewable plan containing:
- **Goal / root cause** — what is wrong or what must change, and why it matters;
- **Proposed changes** — the minimal implementation approach;
- **Approved mutation surfaces** — the concrete path/categories the implementation may modify (for example `src/`, `tests/`, `.github/workflows/`, `scripts/`, `supabase/`, docs/config). Keep this narrow but include routine issue documentation when expected;
- **Risks / decisions** — meaningful tradeoffs, assumptions, migrations, external writes, or scope choices;
- **Validation** — targeted evidence plus the final repository baseline gate.

End the planning response with exactly:

```text
PLAN_STATUS: AWAITING_APPROVAL
```

Then stop and wait for the user. A direct reply such as `ok`, `vai`, `fallo`,
`procedi`, `approvato`, or an equivalent unambiguous authorization immediately
after the plan approves implementation. A question, requested revision, partial
approval, or scope change does not approve the plan: incorporate the feedback,
present the revised plan, emit `PLAN_STATUS: AWAITING_APPROVAL` again, and stop.

The user may explicitly waive this gate in the original request (for example,
"implementa direttamente senza chiedermi approvazione"). Otherwise the gate is
mandatory even when the issue itself appears straightforward.

Planning approval authorizes the issue implementation only. It does **not**
replace any separate approval required by repository policy for Production/hosted
schema, data, configuration, destructive, or similarly consequential mutations.

After approval, create/use the dedicated issue branch if implementation requires
changes and continue with the approved plan. Treat the approved mutation surfaces
as a hard boundary, not a suggestion. Before the **first** edit outside an
approved mutation surface, stop and present a revised plan for approval. Likewise, if
validation or implementation discovers a new runtime/product defect that must be
fixed but was not part of the approved goal, stop before fixing it even when the
fix would make the current issue's tests or CI green.

A revised approval is also required for a new migration, new hosted mutation,
material architecture decision, or materially different risk profile. Ordinary
implementation details and additional tests inside the already-approved surfaces
and goal do not need another approval round. When in doubt about whether a new
surface or newly discovered defect is material, prefer re-approval.

## 3. Keep a retrieval budget

Default per reasoning step:
- aim for <= ~12k characters of returned tool output;
- for ordinary discovery calls, set `max_output_tokens` to about 3000 (raise it only for a targeted need);
- do not concatenate more than two substantial source-file bodies;
- begin with focused ~80–160 line windows around relevant symbols;
- expand only when evidence is insufficient.

Avoid returning a repo-wide search, full diff, project state, and several file dumps in one payload.

Prefer:
- `rg` / `rg --files`;
- exact symbol searches;
- compiler/linter diagnostics;
- `git diff --stat`, `--name-only`, or one-file diffs before a large full diff.

## 4. Keep process polling cheap

For commands expected to take more than ~2 seconds:
- use about **30 seconds** for the initial command yield so ordinary checks can finish without an extra round-trip;
- use about **30 seconds** for subsequent waits as well; this is the stable cadence supported by the observed Codex terminal runtime;
- if a wait returns no actionable new output and the process is still running, immediately issue the next wait without reopening analysis, status discovery, or commentary merely to decide to keep waiting;
- never poll every 1–5 seconds unless the process is genuinely interactive.

For remote CI:
- normal issue publication still stops at `WAITING_FOR_CHECKS` / `WAITING_FOR_CI`; do not watch CI merely to merge sooner;
- only when remote CI timing/completion is itself explicit acceptance evidence, prefer one blocking watcher for the known run (for example `gh run watch <run-id> --exit-status`) and ~30-second waits instead of alternating `gh run view` / `gh pr checks` polling.

Do not request longer tool waits merely to reduce model turns: the observed runtime can split longer waits and cause extra inference cycles. The optimization is to keep each continuation mechanically cheap: when the known process is healthy and still running, wait again immediately.

## 5. Implement

Keep changes issue-scoped.
Preserve unrelated changes.
Prefer existing abstractions/dependencies.

For Next.js behavior that may have changed, consult the version-matched docs in
`node_modules/next/dist/docs/`.

## 6. Validate progressively

For noisy commands:

```bash
scripts/pd-run <command> [args...]
```

For shell scripts that are not executable, invoke the interpreter explicitly, for example:

```bash
scripts/pd-run bash scripts/run-e2e-local.sh tests/e2e/example.spec.ts
```

If `pd-run` fails:
1. use its compact diagnostics;
2. if necessary, run `scripts/pd-log <log-path> [pattern]`;
3. follow one referenced error-context/stack location at a time;
4. use normal/auto screenshot detail first.

Do not dump the raw `.codex-logs` file.

Near completion:
1. relevant targeted tests;
2. `npm run typecheck` when TypeScript changed;
3. `npm run lint` when source/application code changed;
4. `git diff --check`;
5. broad E2E/build/full suites only when risk/scope warrants them.

Do not rerun expensive suites when no relevant code changed after a successful run.

### Frontend/E2E preflight

The initial `context.sh` output already reports `paperdeck_local_e2e_db`.

Before loading any browser/agent-browser skill or reading Playwright/E2E harness files:
- if `paperdeck_local_e2e_db: available`, run only the targeted browser/E2E check justified by the issue;
- if `paperdeck_local_e2e_db: blocked`, treat the repository's disposable-database E2E path as unavailable and do **not** load browser skills, inspect the E2E harness, or attempt Docker-based E2E unless the issue itself is about that infrastructure or browser execution is an explicit acceptance requirement;
- record an environment blocker once rather than repeatedly probing it;
- do not create ad-hoc static-render/browser tests solely to replace blocked E2E. Prefer existing targeted unit/component/static evidence and the normal final baseline.

### Database validation preflight

The same initial `context.sh` output reports `paperdeck_local_db_prereq`. This is the prerequisite for the repository's canonical disposable/local database path; it does not claim that the database is already running.

Before database integration tests or performance benchmarks that need that canonical local database:
- if `paperdeck_local_db_prereq: available`, use the repository's documented canonical local/database setup only as justified by the issue;
- when `paperdeck_test_db_endpoint` is reported, treat it as the current Docker-published host/port/database and do not hard-code a different local port from stale documentation or source defaults;
- prefer the repository-configured `PAPERDECK_TEST_DATABASE_URL`/database helper for execution. Do not print a full database URL or credentials just to learn the endpoint;
- if the endpoint is `not-running-or-unresolved`, start/inspect only the canonical Docker Compose database path when the issue requires it, then resolve `docker compose port database 5432`; do not probe alternative database infrastructure;
- if `paperdeck_local_db_prereq: blocked`, record that blocker once and do **not** probe system PostgreSQL, alternate ports, local database users/clusters, Podman/nerdctl, or ad-hoc substitute databases unless the issue itself is diagnosing that infrastructure;
- when blocked, it is fine to add or validate deterministic benchmark/test harness code that does not require fabricated measurements;
- if actual measured database evidence is an explicit acceptance requirement, do not publish/close the issue without it. Report the blocker and stop after preserving the issue-scoped work.

### Final baseline gate

Before `scripts/pd-final-check`:
- finish the issue-scoped design/risk review and final diff review;
- finish required feature-specific integration/E2E/performance evidence;
- finish `ROADMAP.md`, `CHANGELOG.md`, and the single session note when they are warranted.

Treat the first passing `pd-final-check` as the final repository baseline gate. After it passes, move directly to the issue-scoped commit and `pd-publish`; do not reopen broad source discovery, dependency internals, or architecture investigation merely for extra confidence. If a concrete defect is discovered after the gate and code changes, run the narrow affected evidence and then `pd-final-check` once more.

For the final repository-wide baseline checks, prefer:

```bash
scripts/pd-final-check
```

or, when a production build is warranted:

```bash
scripts/pd-final-check --build
```

This batches independent typecheck/lint/unit checks and returns only a compact summary. Keep feature-specific integration/E2E checks separate and targeted.

## 7. Publish in one compact round-trip

After documentation, final validation, and the issue-scoped commit are complete,
prefer **one** publication tool call.

Use one concise Markdown summary containing the implementation and validation
evidence, then pipe it directly to the helper:

```bash
scripts/pd-publish <issue-number> --summary-file - <<'EOF'
## Summary
- ...

## Validation
- ...
EOF
```

Do not separately run `git push`, `gh pr create`, `gh issue comment`,
`gh pr view`, `gh pr checks`, and `gh pr merge` when `pd-publish` can perform
the same workflow.

`pd-publish` deterministically:

1. requires a clean worktree and the intended `issue-<number>-...` branch;
2. pushes that explicit branch (never `HEAD:<remote-branch>`);
3. creates or reuses its PR, defaulting the PR title to the issue title;
4. reuses the supplied summary as the PR body and appends `Closes #<issue>`;
5. posts one idempotent final issue comment with the PR reference;
6. takes a compact merge/review/check snapshot;
7. merges immediately only when every observed check is pass/skipping, the PR is
   mergeable, and no blocking review exists;
8. enables auto-merge only when observed CI is pending **and at least one pending
   check is required**;
9. never interprets zero checks as green CI;
10. after an immediate merge, verifies the issue is closed and closes it
    explicitly only if GitHub did not already do so.

Treat its final line as the publication state:

- `PUBLISH: MERGED` — done; stop the task.
- `PUBLISH: AUTO_MERGE_ENABLED` — done for this task; do not poll.
- `PUBLISH: WAITING_FOR_CHECKS` / `PUBLISH: WAITING_FOR_CI` — report the state
  and stop; do not poll.
- `PUBLISH: BLOCKED_*` — report the precise blocker and stop.
- `PUBLISH: ERROR (...)` — only then investigate the publication command itself.

Do not rerun publication just to wait for CI. Do not bypass the helper's
worktree, branch, review, conflict, or CI guards.

## 8. Document once

At the end of meaningful work:
- update `ROADMAP.md` only for durable decisions;
- update `CHANGELOG.md` only for notable changes;
- create/update one `sessions/SESSIONi.md`;
- reuse the single issue comment from the publication step rather than posting duplicate summaries.

## 9. Stop context growth

Treat this task as scope-closed once the current issue reaches a terminal publication state (`MERGED`, `AUTO_MERGE_ENABLED`, `WAITING_*`, or `BLOCKED_*`) or is otherwise reported complete.

After that:
- do not continue directly into a different issue, unrelated bug, or "quick fix" in this task, even when it is in the same repository;
- do not begin discovery, create/switch branches, edit files, or publish the new work here;
- return a compact handoff (completed issue/PR state plus the new requested target) and require a fresh task/thread for the new work.

A later request that is still about the same issue/PR may continue here, for example review feedback, an explicit post-CI merge, or a targeted status check. For such follow-ups, reuse the established context: do **not** reread this `SKILL.md`, rerun `context.sh`, or reread `PROJECT_STATE.md` unless the repository/branch state materially changed and the existing context is no longer trustworthy.
