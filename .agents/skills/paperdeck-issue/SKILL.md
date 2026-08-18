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
- use a dedicated issue branch;
- do not use a `codex/` branch prefix;
- if the checkout contains unrelated uncommitted changes, stop before branch-changing/stashing/discarding and report exactly what conflicts with the issue;
- never manipulate unrelated user changes merely to continue.

Inspect only relevant `ROADMAP.md`/`docs/` sections when needed.
Search before opening source files. Search historical sessions first; do not bulk-read them.
Do not query `~/.codex/memories/MEMORY.md` for normal issue work; use repository-local context.

## 2. Plan briefly

State:
- defect/goal;
- why it matters;
- minimal attack plan;
- expected validation.

Keep the plan short.

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
- invoke the command/tool with about **30 seconds** of yield/wait time;
- if it is still running, wait/poll again with about **30 seconds**;
- never poll every 1–5 seconds unless the process is genuinely interactive.

A running process does not need a new model inference every second.

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

Do not continue directly into a different issue.
For separate follow-up work, produce a compact handoff and start a fresh task/thread.
