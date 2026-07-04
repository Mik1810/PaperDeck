# SESSION 14

Date: 2026-07-04
Task: Fix onboarding routing, resilient final submit, and remove a test account

## Work Log

- Started from a clean worktree and confirmed the onboarding issue touched root routing, onboarding guards, app-page guards, final-step personalization, docs, tests, and one requested account removal.
- Added a shared usable-onboarding-state guard: completed onboarding or at least one saved interest now counts as ready for the app, while a bare profile still goes through onboarding.
- Updated `/`, `/onboarding`, `/feed`, `/library`, `/settings`, and paper-detail routing to use the shared onboarding-state rule.
- Removed the old strict `hasCompletedOnboarding` route guard so there is a single onboarding readiness rule in application routing.
- Changed onboarding submit and skip actions to save interests synchronously, then run profile-embedding and initial-feed preload work as best-effort background personalization after the response.
- Updated Playwright app smoke coverage for fresh, completed, and legacy-interest root routing, completed-user `/onboarding` redirects, and the macro/category/micro final submit path.
- Fixed the new Playwright onboarding test locator after the first e2e run also matched the Next.js dev tools button.
- Updated `CHANGELOG.md`, `ROADMAP.md`, and `docs/deployment.md` to describe conditional root routing and non-blocking onboarding personalization.

## Validation

- `npm run lint` passed.
- `npx tsc --noEmit` passed.
- `npm run test:unit` passed with 22 tests.
- `npm run build` passed.
- First `npm run test:e2e` exposed a strict locator match against the Next.js dev tools button; the locator was tightened to exact button names.
- Final `npm run test:e2e` passed with 11 tests passed and 2 Clerk-auth tests skipped.
- `git diff --check` passed.

## Account Removal

- Found exactly one Clerk match for `michaelpiccirilli3` on Gmail before deletion.
- Deleted the matching PaperDeck `profiles.owner_id` row first; verified owned app rows cascaded to zero for profile, interests, playlists, favorites, interactions, recommendations, profile embeddings, and digests.
- Deleted the matching Clerk user; verified a follow-up Clerk search returned zero matches.

## Follow-up: Production Connection Limit

- Investigated production error digest `433591811` from the hosted site.
- Vercel logs showed `EMAXCONNSESSION max clients reached in session mode`, not an auth-cookie issue.
- Stopped the local dev server that was using the shared database.
- Reduced the Drizzle/Postgres client default pool size to one connection and documented `DATABASE_MAX_CONNECTIONS=1`.
- Simplified the onboarding-readiness check from two parallel queries to one query.
- Pinned the Playwright dev-auth owner to `playwright-user` by default so `.env.local` cannot make the test reset a different owner than the app server uses.
- Fixed the first single-query readiness attempt after local verification showed fresh users were incorrectly treated as ready.
- Follow-up validation passed: `npm run lint`, `npx tsc --noEmit`, `npm run test:unit`, `npm run build`, `npm run test:e2e`, and `git diff --check`.
- Updated the service worker to stop intercepting dynamic Next.js/RSC/data GET requests such as `/feed` prefetches, while keeping navigations network-only with an offline fallback and static assets cacheable.
- Service worker follow-up validation passed: `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test:e2e -- tests/e2e/pwa-cache.spec.ts`, and `git diff --check`.
