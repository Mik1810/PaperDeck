---
name: paperdeck-issue
description: Work on one PaperDeck GitHub issue end-to-end with minimal context, targeted repository discovery, compact command output, focused validation, and concise documentation. Use for implementing, fixing, or investigating a specific PaperDeck issue. Do not use for broad product brainstorming or unrelated multi-issue sweeps.
---

# PaperDeck issue workflow

Treat one issue as one coherent unit of context.

## 1. Establish context

Run:

```bash
.agents/skills/paperdeck-issue/scripts/context.sh <issue-number>
```

Use its output as the initial context packet.

Then:
- read `PROJECT_STATE.md`;
- inspect only the relevant sections of `ROADMAP.md`/`docs/` if the issue depends on them;
- search the repository before opening large files;
- inspect the current diff before editing.

Do not bulk-read old `sessions/` files. Read a session only when search shows it is directly relevant.

## 2. Plan briefly

Before implementation, state:
- the defect/goal;
- why it matters;
- the minimal attack plan;
- the validation you expect to run.

Keep the plan short and revise it only if evidence changes the approach.

## 3. Discover cheaply

Prefer deterministic discovery:
- `rg` / `rg --files`;
- TypeScript/compiler/linter output;
- Git history/diff;
- exact database migration/schema searches.

Read targeted file regions. Avoid returning whole files/logs if a small range is enough.

## 4. Implement

Keep changes issue-scoped.
Preserve unrelated working-tree modifications.
Prefer existing abstractions and dependencies.

For Next.js behavior that may have changed, consult the version-matched docs in
`node_modules/next/dist/docs/` before relying on memory.

## 5. Validate progressively

During iteration, run the narrowest relevant check.

For noisy commands use:

```bash
scripts/pd-run <command> [args...]
```

The full log is stored under `.codex-logs/`; only a compact diagnostic summary is printed.

Near completion:
1. run relevant targeted tests;
2. run `npm run typecheck` when TypeScript changed;
3. run `npm run lint` when application/source code changed;
4. run `git diff --check`;
5. run broad E2E/build/full suites only when the affected surface/risk warrants them.

Do not rerun expensive suites if no relevant code changed after a successful run.

## 6. Document once

At the end of meaningful work:
- update `ROADMAP.md` only if a durable product/architecture decision changed;
- update `CHANGELOG.md` only for notable changes;
- create/update one `sessions/SESSIONi.md` with scope, decisions, changes, safety notes when relevant, and validation;
- post one GitHub issue summary with validation and next steps;
- close the issue if complete.

## 7. Stop context growth

Do not continue directly into a different issue.

If follow-up work is materially separate, provide a compact handoff containing:
- current state;
- files changed;
- unresolved risks;
- validation already run;
- recommended next issue/task.

Start that work in a fresh Codex task/thread.
