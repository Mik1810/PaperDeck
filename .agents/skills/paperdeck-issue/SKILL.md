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

For the final repository-wide baseline checks, prefer:

```bash
scripts/pd-final-check
```

or, when a production build is warranted:

```bash
scripts/pd-final-check --build
```

This batches independent typecheck/lint/unit checks and returns only a compact summary. Keep feature-specific integration/E2E checks separate and targeted.

## 7. Publish and finish the issue efficiently

When implementation and local validation are complete:

1. Commit and push the scoped issue branch.
2. Create a **non-draft PR** when the work is complete, with `Closes #<issue>` in the PR body.
3. Post **one concise final comment** on the issue containing:
   - what changed;
   - the important implementation decisions;
   - validation performed;
   - the PR reference;
   - any remaining rollout/operational note that genuinely matters.
4. Take **one PR status snapshot**. Do not watch CI.

Then apply this decision:

- **Merge now** when the PR is mergeable/conflict-free, has no blocking review/change request, and all required checks are successful.
- **Enable auto-merge** when the PR is otherwise ready but required checks are still pending and repository auto-merge is available. Stop after enabling it; do not poll.
- **Stop without merging** when any required check failed, the PR has conflicts, a blocking review exists, branch protection prevents the merge, or the implementation is not actually complete. Report the blocker precisely.

Never bypass failed checks, conflicts, branch protection, or blocking reviews.

After a successful merge:
- verify the issue state once;
- `Closes #<issue>` should normally close it automatically;
- if it is unexpectedly still open, close it explicitly;
- do not start a second task solely to close an issue that GitHub already closed.

Publication must not trigger broad tool-registry enumeration. Use the installed GitHub workflow/tool directly, or authenticated `gh` commands when appropriate.

## 8. Document once

At the end of meaningful work:
- update `ROADMAP.md` only for durable decisions;
- update `CHANGELOG.md` only for notable changes;
- create/update one `sessions/SESSIONi.md`;
- reuse the single issue comment from the publication step rather than posting duplicate summaries.

## 9. Stop context growth

Do not continue directly into a different issue.
For separate follow-up work, produce a compact handoff and start a fresh task/thread.
