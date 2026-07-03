# SESSION 10

Date: 2026-07-03
Task: Stop caching authenticated feed pages in the service worker (Issue #41)

## Issue

Issue #41 reported that the service worker precached `/feed` and cached successful navigation responses. Since `/feed` is authenticated and personalized, storing it in Cache Storage could show stale private content offline or on shared devices.

## Why it matters

Authenticated HTML should stay network-only unless the app has a deliberately public, non-personalized shell. Static assets are safe to cache, but feed/library/settings/paper pages can contain user-specific state.

## Plan

1. Remove `/feed` from service worker precache.
2. Stop writing navigation HTML responses into Cache Storage.
3. Keep static asset caching and use `/offline.html` as the navigation fallback.
4. Add PWA coverage for cache contents and offline fallback behavior.
5. Document the manual PWA release checklist.

## Changes

- Updated `public/sw.js` to use `paperdeck-v2`, cache only static assets and `/offline.html`, and delete old `paperdeck-*` caches during activation.
- Removed the navigation page cache so authenticated navigations are network-only.
- Added `tests/e2e/pwa-cache.spec.ts` to verify that `/feed` and navigation HTML are not cached and that offline `/feed` shows `offline.html`.
- Added `docs/pwa.md` with a manual checklist for login, logout, offline, and service worker update behavior.

## Verification

- `npx eslint tests/e2e/pwa-cache.spec.ts` — passed.
- `npx playwright test tests/e2e/pwa-cache.spec.ts` — passed.
- `git diff --check -- public/sw.js tests/e2e/pwa-cache.spec.ts docs/pwa.md` — passed.
- `npm run lint` — not clean globally because of unrelated existing errors in `src/components/playlist-papers.tsx` and `src/lib/render-latex.ts`, plus unrelated warnings.

## GitHub issue status

- Closed #41 on GitHub as completed with `gh issue close 41 --repo Mik1810/PaperDeck --reason completed`.
- The GitHub connector could not close the issue directly because it returned `403 Resource not accessible by integration`; local `gh` was authenticated as `Mik1810` and succeeded.
