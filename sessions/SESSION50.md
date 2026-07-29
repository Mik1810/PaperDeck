# Session 50

## First-install PWA update prompt

- Reproduced the mobile prompt in a clean Chromium context with no prior
  service worker: the first install claimed the page and was incorrectly
  interpreted as an update.
- Changed `updatefound` handling so it becomes an update only when a service
  worker controller already exists.
- Kept `controllerchange` handling for real updates and removed its listener
  during provider cleanup.
- Added a mobile-sized Playwright regression that removes registrations and
  caches, opens a fresh page, waits for the first worker to control it, and
  proves that no update prompt is rendered.

## Validation

- `npm run lint`
- `npm run typecheck`
- `npm run test:unit` — 84 passed
- `npx playwright test tests/e2e/pwa-cache.spec.ts --project=chromium --project=mobile-chrome` — 4 passed
- `npm run build`
- `git diff --check`
