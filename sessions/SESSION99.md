# Session 99

## Feed card shadow correction

### Scope

- Reduced the active paper card shadow from a broad 60px elevation to a softer
  32px elevation.
- Disabled elevation on the rendered next-card preview so stacked deck shadows
  no longer combine into a gray band below and beside the active card.
- Kept the loading skeleton visually consistent with the active card.
- Extended the authenticated feed smoke test to require elevation on the active
  card and, when a next-card fixture is present, no shadow on that preview.

### Validation

- `npm run typecheck`
- `npm run lint`
- Authenticated `/feed` E2E smoke in Chromium and Mobile Chrome
- Mobile Playwright screenshot inspection

The first E2E invocation used the runner's stale fallback database port and did
not reach the application. Loading `.env.local` through Next.js resolved the
current Docker-published endpoint; the final desktop and mobile run passed.
