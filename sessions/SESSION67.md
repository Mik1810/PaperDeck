# Session 67

## Scope

- Recover the authenticated Research Groups route after the database-pool
  rollout left it indefinitely in the loading boundary.
- Harden the route and its verification against connection starvation and
  aborted navigation requests.
- Audit the reportedly truncated `public/offline.html` and the offline PWA
  fallback.

## Diagnosis

- The Transaction-pooler Production deployment reached `READY`, but two recent
  authenticated `/groups` requests ended with runtime status `0` instead of a
  completed response.
- PostgreSQL showed one Supavisor backend waiting on `ClientRead` for the
  playlist lookup performed by `ensureReadLaterPlaylist`; there was no blocker,
  backend transaction ID, pool saturation, or slow SQL lock.
- A later read-only load probe completed 40/40 equivalent request batches on
  port 6543. The evidence therefore does not establish a general
  Postgres.js/Transaction-pooler incompatibility; the stronger application
  risk was a render-time profile upsert and playlist provisioning step combined
  with a one-connection serverless client and aborted/concurrent requests.
- Production was restored to Session mode on port 5432 with the already-deployed
  one-connection client. The recovery deployment reached `READY`, the public
  `/groups` request returned HTTP 200, and a read-only connection audit found
  only two idle Supavisor clients with zero blocked sessions.

## Changes

- Made the `/groups` page render path read-only by using `requireOwnerId()` and
  removing `ensureUserProfile()`. Group creation still performs the existing
  guarded profile/bootstrap operation before any group write.
- Reduced the shared client's idle timeout to five seconds and aligned the
  disposable group-workspace E2E with Production's one-connection limit.
- Confirmed Supavisor ignores Postgres.js startup overrides for
  `statement_timeout` and `application_name`; no ineffective timeout option was
  retained. The existing database-role statement timeout remains two minutes.
- Disabled automatic Next.js prefetch on group cards so a rendered list cannot
  fan out into multiple expensive workspace requests.
- Added a route-local Research Groups error boundary and light-background
  loading skeletons for both group routes. These boundary components are
  deliberately presentational and do not mount AppShell's notification fetch
  while the main database request is pending or failed.
- Classified `/groups` explicitly as personalized/private-no-store and extended
  the cache-policy regression coverage.
- Confirmed `public/offline.html` is complete: 80 lines and 2,303 bytes in the
  repository and Production. The `#L4` suffix in the GitHub URL only selects
  line 4.
- Fixed the actual offline defect: cache `/apple-touch-icon.png` during service
  worker installation, advance the cache version, and assert both cache
  presence and a decoded offline image in Playwright.

## Safety

- No application row, Clerk user, Clerk session, or database session was
  created, changed, cancelled, or deleted during diagnosis.
- No secret or personal identifier was printed or written to a versioned file.
- Research-group reads remain enabled and writes remain disabled.

## Validation

- `npm run lint`.
- `npm run typecheck`.
- `npm run test:unit` (`117/117` passed), including explicit `/groups`
  private-cache classification and render-bootstrap/prefetch guards.
- `npm run build`.
- `npm run test:e2e:group-workspace`: member, owner, and mobile phases passed
  with `DATABASE_MAX_CONNECTIONS=1`; the report confirmed zero remote mutations
  and zero Clerk sessions.
- PWA cache spec: `4/4` desktop/mobile checks passed with database and Clerk
  credentials explicitly empty. Dynamic/RSC requests remained outside Cache
  Storage, and the offline icon was present in the install precache and decoded
  successfully with the network disabled.
- `node --check public/sw.js` and `git diff --check`.
- Three independent adversarial reviews identified and drove removal of
  render-time writes, notification-fetching boundary shells, the false-positive
  PWA cache test, automatic group-card prefetch, and unverified deployment
  wording.
- Preview deployment `dpl_6EHnHUGaXRQzanX8DYKtd99LUer7` reached `READY`. PR
  #132 was merged as `c6717079`, and Production deployment
  `dpl_4GoXidSSrZbLxX9aJVpVKmiBqLCX` reached `READY` on the Session-pooler
  recovery configuration.
- Final authenticated Production confirmation succeeded: the user reported the
  workspace was no longer blocked, four correlated `/groups` requests completed
  with HTTP 200, and the route's runtime-error window was empty. A post-request
  database audit found four idle Supavisor clients, zero blocked sessions, and
  zero active queries older than ten seconds.
- Production `offline.html` and `sw.js` checksums matched the merged files. The
  offline page remained complete at 80 lines and 2,303 bytes.
