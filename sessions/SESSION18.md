# SESSION 18 — 2026-07-06

## Summary

Product positioning closure and codebase analysis, new issue creation, tooling improvements.

## Changes

### Product positioning (issues #2, #3, #4, #5 — CLOSED)

- **README.md**: rewrote intro with triage-deck positioning ("Not another reference manager. A daily paper deck for CS researchers"). Added explicit MVP scope with keep/avoid table.
- **ROADMAP.md**: added "Product Guardrails" section with 6 rules, keep/avoid feature table. Fixed MathJax→KaTeX ambiguity, Prisma→Drizzle, embedding model alignment. Updated open questions section: migrated resolved Clerk JWT question to completed section.
- **AGENTS.md**: fixed embedding model reference (BGE-small→MiniLM).

### Tooling

- **`scripts/create-issues.ts`**: markdown-to-github-issues importer (issue #45 — CLOSED). Parses `---` separated blocks with `## Title` and `labels:` line. Detects duplicate open issues by title, auto-creates missing labels, supports `--dry-run` and `--verbose`.
- **`package.json`**: added `issues:import` npm script.
- **`AGENTS.md`**: documented issue import format and usage.

### Codebase analysis

- **`ANALYSIS.md`**: comprehensive scan of entire repo (394 lines). Found 4 critical, 15 high, 30+ medium/low issues across security, bugs, performance, tests, CI, docs.
- **`issues/analysis-criticals.md`**: 9 formatted issues extracted from analysis.

### New GitHub issues created (9)

1. Fix RLS policies on profiles table in Drizzle schema (p0) — CLOSED
2. Sync optimistic state with props in paper-card and playlist-papers (p1 bug) — CLOSED
3. Race condition in playlist creation (p1 bug) — CLOSED
4. Leak internal error messages in API response (p1 security) — CLOSED
5. Missing noopener on external paper links (p1 security) — CLOSED
6. Embedding model mismatch: three different sources of truth (p1 bug)
7. Missing unique constraint on user_paper_interactions (p1 bug)
8. Replace full-page anchor with Next.js Link in playlist sidebar (p1 bug)
9. Add mobile viewport to Playwright test config (p1 test)

### Fixes applied (critical issues #55-#59)

- **#55**: `src/db/schema.ts` — Added `using` and `withCheck` to `profiles_select_own` and `profiles_update_own` RLS policies.
- **#56**: `src/components/feed-deck.tsx` — PaperCard key now includes favorite/saved state to force remount on prop change. `src/app/library/page.tsx` — PlaylistPapers key includes paper IDs to force remount.
- **#57**: `src/components/playlist-sidebar.tsx` — Replaced `onSubmit={() => setIsCreating(false)}` with client-side handler that only closes form after `createPlaylistAction` succeeds. Added pending state with "Saving..." label.
- **#58**: `src/app/api/deck/route.ts` — Error message now returns generic "Internal error" in production.
- **#59**: `src/components/paper-card.tsx` — `rel="noreferrer"` → `rel="noreferrer noopener"`. Also moved `aria-label` to button from icon.

Build, lint, and all 22 unit tests pass.
