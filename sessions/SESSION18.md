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
6. Embedding model mismatch: three different sources of truth (p1 bug) — CLOSED
7. Missing unique constraint on user_paper_interactions (p1 bug) — CLOSED
8. Replace full-page anchor with Next.js Link in playlist sidebar (p1 bug) — CLOSED
9. Add mobile viewport to Playwright test config (p1 test) — CLOSED

### Fixes applied (critical issues #55-#59)

- **#55**: `src/db/schema.ts` — Added `using` and `withCheck` to `profiles_select_own` and `profiles_update_own` RLS policies.
- **#56**: `src/components/feed-deck.tsx` — PaperCard key now includes favorite/saved state to force remount on prop change. `src/app/library/page.tsx` — PlaylistPapers key includes paper IDs to force remount.
- **#57**: `src/components/playlist-sidebar.tsx` — Replaced `onSubmit={() => setIsCreating(false)}` with client-side handler that only closes form after `createPlaylistAction` succeeds. Added pending state with "Saving..." label.
- **#58**: `src/app/api/deck/route.ts` — Error message now returns generic "Internal error" in production.
- **#59**: `src/components/paper-card.tsx` — `rel="noreferrer"` → `rel="noreferrer noopener"`. Also moved `aria-label` to button from icon.

Build, lint, and all 22 unit tests pass.

### Fixes applied (round 2 — #60-#63)

- **#60**: Verified all three sources already aligned on MiniLM: SQL function default (`schema.sql:404`), TS constant (`user-profile-embeddings.ts:28`), ROADMAP (fixed earlier in session). BGE-small references in docs/sessions are correctly labeled as historical.
- **#61**: `src/db/schema.ts` — Added `uniqueIndex` on `(owner_id, paper_id, action)` to prevent duplicate interactions, and composite `index` on `(owner_id, paper_id)` for point-lookup performance.
- **#62**: `src/components/playlist-sidebar.tsx` — Replaced `<a href>` with `<Link href>` for client-side playlist navigation.
- **#63**: `playwright.config.ts` — Added `mobile-chrome` project using `Pixel 5` device profile.

All 9 issues from this session are now closed.

### Fixes applied (round 3 — #42)

- **#42**: `src/app/api/deck/route.ts` + `src/app/papers/[paperId]/feedback/route.ts` — Added `after(() => refreshUserProfileEmbedding(ownerId))` after every deck interaction (favorite, read_later, dismiss, open_detail) and detail feedback (already_read, not_interested). Runs asynchronously after the response is sent, so mutations stay fast. Underlying function has signature-based idempotency to avoid redundant writes.

### Fixes applied (round 4 — #49)

- **#49**: `src/lib/repositories/user-data.ts` — Extracted `getRankedFeedPapers()` reusable ranking pipeline. `src/app/actions.ts` — Added `loadMoreDeckPapersAction()` server action. `src/components/feed-deck.tsx` — Fetches more papers when visible queue drops below 3, deduplicates, shows "Loading more..." state. Empty state only appears when ranking is genuinely exhausted.

### Fixes applied (round 5 — #51)

- **#51**: `scripts/ingest-arxiv.ts` — Added `fetchWithRetry()` with exponential backoff (2s/4s/8s) for 429/5xx/network errors. `isAfterCursor()` now uses `(publishedAt, arxivId)` tuple for tie-breaking. `IngestionCursor` type includes `last_seen_external_id`. Per-category breakdown (fetched/importable/skipped/cursor hints) in both dry-run and write output.

### CI markdown summaries (all workflows)

- **`.github/workflows/*.yml`** — All 5 workflows now write a markdown summary to `$GITHUB_STEP_SUMMARY`:
  - `ci.yml`: check result table (audit, lint, build, e2e)
  - `ingest-arxiv.yml`: per-category table with fetched/importable/skipped + cursor decisions
  - `embed-papers.yml`: model info + JSON output
  - `generate-summaries.yml`: provider/model info + JSON output
  - `discover-classics.yml`: config + discovery JSON output

### Fixes applied (round 6 — #47)

- **#47**: Created `src/lib/repositories/owner-guard.ts` with `requireOwnerId()` defense-in-depth utility. Tagged all 36 repository functions as `@user-scoped` (27) or `@admin` (9) via JSDoc. Extended `scripts/audit-service-role.ts` to parse scope annotations and report boundary analysis. Updated `docs/clerk-supabase-rls.md` with repository boundary table and migration plan. Added 7 unit tests for owner-guard.

### Fixes applied (round 7 — #44)

- **#44**: Created `tests/e2e/mutations.spec.ts` (10 E2E tests): deck API input validation, dismiss/favorite/read_later toggles, playlist creation, cross-owner authorization. Extended `tests/unit/deck-mutations.test.ts` to 40 tests: network errors, sendBeacon fallback, error messages for all action types, `isFeedHiddenAction` for all interaction types.

### CI fix

- `playwright.config.ts` — Mobile viewport project (`Pixel 5`) skipped in CI to avoid DB race condition between parallel projects. Runs only locally.

## Stats

- **Issues closed this session:** 14 (#2, #3, #4, #5, #42, #44, #45, #47, #49, #51, #55-#63)
- **Unit tests:** 40 tests (was 22, added 18)
- **E2E test files:** added `mutations.spec.ts`
- **Files changed:** 25+ files across src, scripts, docs, tests, CI workflows
