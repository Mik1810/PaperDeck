# Session 34

## PWA update prompt mobile regression

- Reproduced two mobile Playwright failures caused by the persistent `New version available` prompt intercepting feed and settings actions.
- Moved the prompt from above the fixed bottom navigation to below the mobile header.
- Limited pointer handling to the prompt itself and exposed update availability through a named live region without colliding with onboarding status semantics.
- Validation passed: lint, typecheck, 58 unit tests, production build, two targeted mobile regressions, targeted mobile onboarding, and the full Playwright suite (`54 passed`, `4 skipped` Clerk-auth cases).
