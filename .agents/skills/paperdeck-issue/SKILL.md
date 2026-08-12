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

## 7. Publish efficiently

Publication must not trigger a broad tool-registry dump.
Use the installed GitHub workflow/tool directly, or an authenticated `gh` fallback.
Never enumerate `ALL_TOOLS` merely to discover PR actions.

After a locally validated draft PR:
- take at most one non-watching CI/status snapshot;
- report pending checks accurately;
- do not `--watch` or repeatedly poll CI unless the user explicitly asks.

## 8. Document once

At the end of meaningful work:
- update `ROADMAP.md` only for durable decisions;
- update `CHANGELOG.md` only for notable changes;
- create/update one `sessions/SESSIONi.md`;
- post one concise issue summary;
- close only when completion criteria are actually satisfied.

## 9. Stop context growth

Do not continue directly into a different issue.
For separate follow-up work, produce a compact handoff and start a fresh task/thread.
