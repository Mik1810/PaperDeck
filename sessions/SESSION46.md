# Session 46

## Clerk resource-level authorization migration

- Addressed issue #105 after confirming `@clerk/nextjs` 7.5.11 deprecates `createRouteMatcher()` for authentication gates.
- Inventoried all App Router pages, Route Handlers, and exported Server Actions before changing the proxy.
- Confirmed privileged resources already use `requireOwnerId()` or `requireUserContext()` and the public Clerk webhook verifies its signature.
- Moved paper-detail and feedback authentication ahead of parameter and form parsing.
- Removed path-based `auth.protect()` from `src/proxy.ts` while retaining `clerkMiddleware()`, authorized-party validation, the test-only Clerk auth-entry bypass, and private cache headers.
- Added a source-discovered unit test that fails for new unguarded pages, Route Handlers, or Server Actions and separately requires webhook signature verification.
- Expanded the real-Clerk anonymous smoke across every protected page family, RSC navigation, deck API mutation, and paper-feedback mutation.
- Documented the resource-level authentication boundary in `docs/security.md`.
