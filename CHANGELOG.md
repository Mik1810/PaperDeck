# Changelog

All notable changes to this project will be documented in this file.

This project follows Semantic Versioning.

## [Unreleased]

### Fixed

- Removed profile and default-playlist bootstrap writes from authenticated
  `/onboarding`, `/search`, and `/settings` renders. Explicit onboarding and
  settings mutations remain the normal provisioning boundary, while other
  owner mutations retry once after a narrowly recognized missing-profile
  foreign-key failure and create only the minimal profile required to proceed.
- Bounded recommendation-analytics retention to independently committed,
  ordered 10,000-row batches with `SKIP LOCKED`, capped each table pass at 100
  batches, and counted PostgreSQL command results without transferring deleted
  IDs. Global `(shown_at, id)` and `(delivered_at, id)` indexes now support the
  pruning keysets, while statement/lock timeouts and workflow output expose and
  bound batch latency and truncation.
- Made fresh recommendation batches a true feed fast path. Initial and live
  cache lookups now run before taxonomy, semantic candidates, or full user
  ranking state; PostgreSQL filters current Favorites, playlist membership,
  and durable exclusions in the lookup, paper hydration starts only after the
  usable-batch threshold is met, and presentation state loads independently.
- Removed overlapping catalog reads from sparse digest generation. The digest
  now fetches ranked candidates from the maximum 30-day recency window once,
  then selects the first sufficient 7-, 14-, or 30-day window in memory while
  preserving ranking and feed-exclusion semantics.
- Made Library loading proportional to the visible collection instead of the
  owner's complete private library. The initial response now contains counts,
  playlist metadata, and at most 24 papers from the selected collection;
  Favorites, Ignored, custom playlists, and later pages load on demand through
  private no-store keyset pagination backed by matching database indexes.
- Separated delivered recommendation batch items from actual feed impressions.
  Loading a 50-paper deck no longer records exposure for hidden cards; an
  authenticated, idempotent visible-card write now creates one impression when
  a card becomes active while preserving deck-action attribution and the
  existing analytics retention window.
- Reduced background notification work: the closed header bell now polls only
  the unread count, loads the latest notification page on demand when opened,
  cancels or shares overlapping requests, and debounces browser lifecycle
  refresh bursts. The full notification-history route remains independently
  paginated.
- Kept consumed or rejected papers out of future feed batches independently of
  the 200-row ranking-history window. `open_detail`, `dismiss`,
  `not_interested`, `read`, and `already_read` now materialize one durable,
  owner-scoped exclusion per paper; current Favorites and membership in any
  private playlist remain reversible collection exclusions.
- Made profile embeddings follow current collection state on both additions
  and removals. Favorites and deduplicated membership in any private playlist
  are now authoritative signals, append-only collection events no longer add a
  duplicate weight, dirty generations are excluded from semantic retrieval,
  and mutation repositories consistently schedule a guarded refresh. Existing
  embeddings are invalidated once during migration so the old weighting cannot
  survive the rollout.
- Prevented older concurrent profile-embedding refreshes from overwriting newer
  user state. Ranking-relevant mutations now advance a per-user input
  generation, refresh writes conditionally lock and verify that generation,
  superseded work retries, and same-instance requests share one in-flight queue.
  Onboarding and settings now use the same complete topic, collection, and
  interaction aggregation path as every other refresh.
- Made Favorite and Read later mutations atomic and retry-safe. Clients now
  send an explicit ON/OFF target instead of a toggle, collection state and its
  append-only interaction event commit in one transaction, duplicate retries
  are no-ops, and profile refreshes are skipped when state did not change.
- Made local Docker and CI database resets apply the immutable initial schema
  followed by the complete ordered Supabase migration history. The CI parity
  gate now verifies the full-text/trigram search column, extension, indexes and
  query shape, preventing hosted-only schema features from escaping local tests.
- Removed a stale generated uniqueness declaration for paper interactions that
  was absent from both the migration-built and hosted schemas.
- Replaced the live feed's unbounded full-catalog fallback with a bounded
  two-phase ranking pipeline. Semantic and catalog retrieval now transfer only
  lightweight score inputs for at most 300 catalog candidates, preserve topic
  and interaction feedback, and hydrate authors, abstracts, summaries, and
  presentation metadata only for the final 50 papers. Explicit Drizzle
  projections also prevent paper embeddings and ingestion metadata from being
  transferred by ordinary catalog and detail reads.
- Made the feed consume its optimistic opened-paper marker on browser
  `pageshow` as well as initial mount, so an instant mobile Back restoration
  from the browser's page cache cannot briefly restore the paper just opened.
- Upgraded Next.js from 16.2.9 to 16.3.0 and `fast-xml-parser` from 5.9.3
  to 5.10.1, removing all known vulnerabilities from the production dependency
  tree. The refreshed lockfile also resolves the affected nested Sharp,
  PostCSS, Nano ID, brace-expansion, and JS-YAML versions without forced or
  breaking dependency changes.
- Collapsed `/groups/[groupId]` from an approximately 17-statement repository
  fan-out into one authorized PostgreSQL statement. A materialized group-access
  CTE now gates correlated paper, contributor, member, notification-preference,
  and private `Read later` count subqueries, preserving the 500-paper limit and
  returning no workspace data after membership revocation.
- Prevented Vercel serverless instances from exhausting Supabase's 15-client
  Session pool. The Drizzle runtime now uses a bounded node-postgres pool, which
  queues excess work instead of protocol-pipelining multiple statements over a
  Supavisor Transaction connection, and retains bounded connect/idle timeouts.
  A read-only Transaction-pooler probe exercises both raw and real `/groups`
  query shapes under concurrency without reporting identifiers. The
  authenticated `/groups` route also remains read-only during rendering instead
  of updating the profile and provisioning `Read later` on every visit. Preview
  and Production use Transaction mode with a three-connection application pool;
  isolated local development and CI use Docker PostgreSQL. Drizzle Kit and
  maintenance scripts use a separate Session-pooler URL.
- Stabilized the research-group loading experience with a route-local retry
  boundary, an AppShell-consistent skeleton, disabled automatic prefetch for
  expensive group workspaces, and an E2E database-client limit matching
  Production.
- Precached the offline fallback icon and advanced the service-worker cache
  version so a clean first offline visit no longer renders a broken image.
- Aligned the local filenames of the in-app group-invitation response and
  managed automatic-RLS hardening migrations with their exact versions in the
  shared Supabase migration history. After a strict read-only catalog audit
  confirmed all 17 older local migrations were already structurally present,
  recorded only those versions as applied in remote migration metadata. No
  migration SQL was replayed and no application schema or data was changed or
  deleted; a final dry-run now proposes only the two still-local #99 migrations.
- Set `touch-action: pan-y` on the `PaperCard` internal scrollable container
  and its `article` ancestor to prevent the browser from stealing horizontal
  touch gestures for native vertical scrolling, fixing mobile deck swipe
  immediately resetting to centre. The earlier `touch-action: pan-y` on the
  outer `motion.div` was ineffective per the CSS touch-action algorithm because
  the nearest scroll containers are inside the card, not outside it.
- Restored the `requireUuid` helper in `src/app/actions.ts` that was dropped
  while resolving the `main` merge on `agent/notification-center`, fixing the
  notification-center TypeScript build failure.

### Changed

- Added a secret-safe hosted database configuration gate: Vercel Preview and
  Production builds now fail before deployment unless the runtime uses the
  Supabase shared Transaction pooler on port 6543 with a three-connection
  application pool. Local development and standard CI remain on their isolated
  Docker databases.
- Isolated local development and standard Playwright CI from the shared
  Supabase project. PostgreSQL 17 plus pgvector 0.8.0 now runs in Docker with a
  loopback-only destructive guard; CI uses a deterministic synthetic catalog
  without Supabase secrets, while an explicit catalog-only refresh copies no
  profiles, collaboration hashes, interactions, playlists, groups, or
  notifications from Production.

- Defined the #99 shared-list contract: groups may be empty; papers are
  chronological without manual positions, reorder, or list revisions; members
  remove only their own additions while owner/admin may moderate any; and
  copying a group paper into a private Library remains an explicit action.

- Added a conditional database hardening migration that removes unnecessary
  direct `PUBLIC`, `anon`, and `authenticated` execution of Supabase's managed
  `rls_auto_enable()` helper without replacing or disabling its event trigger.
  A disposable PostgreSQL regression test verifies automatic RLS still works.
  The migration is deployed to the shared PaperDeck project; remote metadata
  and security-advisor checks confirm the helper finding is resolved while the
  automatic-RLS trigger remains enabled.
- Replaced direct bookmark-to-`Read later` buttons on feed, digest, and paper
  detail with an owner-scoped multi-playlist picker, while preserving swipe as
  the quick `Read later` path and recording only one ranking save signal per
  paper.
- Unified `Read later`, Favorites, Ignored, and custom playlists as selectable
  Library collections, with system collections separated from custom lists,
  `Read later` selected by default, and transient pencil-driven edit mode kept
  out of the URL. The default collection is server-rendered first while the
  normalized remaining collections preload privately in the background, so
  collection and edit changes no longer require dynamic route navigation.
  Custom rename/delete actions remain in a separate menu, paper rows open their
  internal detail, and the desktop detail card uses the available content
  width.
- Split the live Clerk/Supabase smoke into a non-mutating profile-isolation
  check and an explicit group lifecycle test, both restricted to Clerk
  Development test identities, with masked evidence and mandatory
  temporary-session revocation.
- Removed automated Clerk Production sign-in and session testing. The live RLS
  harness now rejects Production targets, `sk_live_` keys, and ordinary user
  addresses.
- Split recommendation evaluation into an explicitly perfect synthetic sanity check and a harder blocking baseline with graded relevance, overlapping profiles, noisy semantic scores, feedback, seen papers, conflicting rank signals, worst-profile floors, and zero seen-paper leakage.
- Migrated Clerk authorization from deprecated path matching in `src/proxy.ts` to resource-level guards on every privileged page, Route Handler, and Server Action while retaining Clerk request context, authorized-party validation, and cache policy.
- Classified authenticated and personalized routes under an explicit private/no-store browser and CDN policy while leaving PWA static assets cacheable.
- Made exact-email collaboration discovery opt-in for new and existing identities, with explicit Settings consent and regression coverage for the undiscoverable default.
- Approved the private research-group charter, choosing exact-email discovery opt-in and defining roles, retention, account closure, threat controls, release stops, and research-user validation.
- Clarified the Clerk/Supabase authorization boundary: deterministic and live
  A/B isolation tests use dedicated Clerk Development identities only.

### Added

- Added the #99 shared-paper foundation: membership-scoped read RLS,
  service-role-only atomic add/remove/preference operations, duplicate and
  500-item guards, detached `Former member` provenance, ten-minute addition
  notification aggregation, important removal notifications, 90-day bounded
  activity retention, and an eight-case isolated PostgreSQL 17 gate proving
  role isolation and zero writes to personal ranking/library tables. The two
  migrations are applied to the shared Supabase project with zero shared-paper
  or activity rows; reads are enabled while the write kill switch remains
  disabled.
- Added and deployed the #99 group workspace: `/groups` lists memberships and
  incoming invitations, `/groups/[groupId]` presents the chronological shared
  list and responsive member management, and the Clerk account menu links the
  workspace without adding another navbar item. Authenticated Server Actions
  cover creation, invitation, roles, removal, preferences, leave/delete, and
  paper add/remove; a private no-store catalog search powers the add dialog.
  Shared cards expose an explicit `Save privately` playlist picker. The
  production deployment is live with research-group reads enabled and writes
  still disabled.
- Added a disposable native-PostgreSQL browser gate for the #99 workspace. It
  exercises member and owner permissions, create/delete, catalog search,
  chronological add/remove, notification preferences, role changes, leave,
  explicit private playlist saving, personal-ranking isolation, and responsive
  mobile rendering without Clerk sessions or shared Supabase writes.

- Added and deployed the #98 notification center: authenticated header bell with `99+`
  badge, latest-20 desktop popover/mobile bottom sheet, reconnect/focus polling,
  important-event toasts, inline request actions, and a private paginated history
  page with category/read filters and archive controls. A service-role-only RPC
  lets the authenticated invitation recipient respond in app while consuming the
  existing single-use digest. Its seven-case isolated PostgreSQL gate passes,
  and the service-role-only RPC is applied to the shared Supabase project with
  both research-group runtime switches still disabled.
- Added the local #97 durable-notification foundation: atomic idempotent database
  events for friendship, invitation, membership, role, and ownership changes;
  recipient-only RLS and acknowledgement grants; source-linked cleanup; a
  server-only recipient-scoped repository; and count-only daily batched deletion
  after the fixed 90-day retention window. Realtime delivery and shared-paper
  aggregation remain deferred. Both incremental and standalone-schema local
  PostgreSQL validation pass. The migration is applied to the shared Supabase
  project with zero backfilled rows; structural checks and advisors passed, while
  the manual retention dry-run passed with zero expired rows. Scheduled retention
  is enabled after explicit approval and remains bounded to expired rows.

- Added and deployed the #96 research-group invitation and membership lifecycle:
  service-role-only transactional RPCs enforce owner/admin/member hierarchy,
  exact-email opt-in and invitation policy, friendship/block checks, seven-day
  single-use digest-only tokens, acceptance/cancellation/revocation, role
  changes, removal/leave, and account-deletion cleanup. The shared Supabase
  rollout passed synthetic lifecycle, cleanup, privilege, and advisor checks
  with both group kill switches left disabled.
- Added the #107 Clerk account-deletion lifecycle: a service-role-only
  atomic RPC performs research-group succession before collaboration identity
  cleanup, with signed-webhook, retry, idempotency, concurrency, privilege, and
  rollback coverage. The migration and synthetic signed-webhook gate passed
  with exact cleanup on the shared PaperDeck Supabase project used by
  Development and Vercel Production. The webhook lifecycle is deployed in
  Production with unsigned-request rejection and runtime health verified.
- Added the #95 private research-group foundation: separate group and membership tables, owner/admin/member ACL, private database-backed read/write switches, RLS self-membership isolation, deterministic transactional ownership succession, safe public member projections, and negative PostgreSQL integration coverage. The migrations and application foundation are deployed against the shared PaperDeck Supabase project with both switches disabled.
- Extended the live Clerk/Supabase integration smoke with a temporary private group, proving real-JWT owner, outsider, member, and revoked behavior plus self-only raw membership reads, direct-write denial, verified database cleanup, flag restoration, and temporary-session revocation.
- Added a source-discovered authentication inventory test that rejects new unguarded App Router pages, Route Handlers, and Server Actions while requiring signature verification for the public Clerk webhook.
- Added an opt-in Clerk Development shared-device cache smoke that signs in as test user A, creates a temporary private marker, signs out, signs in as B, proves HTML/RSC/API/history/Cache Storage isolation, and verifies exact playlist/session cleanup.
- Added a no-write inference mode for evaluating local llama.cpp/Unsloth triage summaries before updating Supabase, with strict structured output, source-grounding validation, and a bounded plain-English retry for model-generated equations.
- Added section-aware PDF sampling to local summary generation so a 20,000-character context budget covers methods, results, and conclusions instead of only the start of each paper.
- Grounded local triage prompts in labeled paper sections, emphasizing cross-section synthesis over abstract paraphrase while constraining unsupported implications and adjacent audiences.
- Aligned local summary validation with field-specific triage lengths instead of applying one broad word-count range to every section.
- Tightened local summary grounding for application domains, implementation relationships, and unambiguous baseline attribution.
- Made local and GitHub summary writes conditional on a still-null destination, reported failed arXiv IDs for fallback processing, and aligned the GitHub fallback prompt with the grounded local format.
- Added monitored local inference behavior: llama.cpp connectivity failures stop the batch immediately and calls slower than 60 seconds emit warnings.
- Added a checkpointed JSON report option for unattended local summary batches, preserving progress and failure IDs without secrets.
- Added a versioned offline recommendation-stability gate: App CI enforces deterministic NDCG, recall, catalog coverage, and cross-profile overlap thresholds, while a separate scheduled/manual workflow reports reranker p95; social-domain ranking isolation is covered separately.
- Added private mutual friendships with transactional requests, crossed-request auto-acceptance, 30-day decline cooldowns, daily rate limits, cancel/unfriend flows, directional blocks, connection management UI, and ranking-isolation tests.
- Added collaboration identities with an explicit public display name, exact-email HMAC discovery, opt-out visibility, group invitation preferences, a ten-per-minute lookup limit, Clerk email-change synchronization, and RLS isolation tests.
- Added deterministic A/B/anonymous Supabase RLS isolation tests as the first security gate for cross-user collaboration.
- Added an automated live A/B smoke test that creates and revokes temporary Clerk sessions and verifies Supabase RLS without manual JWT handling.
- Moved Clerk RLS test-user email identifiers out of source control and into required local environment configuration.
- Refined the post-MVP social plan around private research groups, mutual friendships, exact-email discovery with opt-out, deterministic ownership succession, durable realtime-assisted notifications, paper activity events, and a separately gated future group chat.
- Added a versioned end-to-end social-interactions development plan: recommendation gates, privacy/ACL foundations, metadata sharing, private academic subscriptions, invite-only collections, moderation, and explicit public-release gates.
- Added a Zod validation layer (`src/lib/schemas/*`) and replaced unsafe `as` casts with `.parse()` in semantic retrieval and the ingest/enrich scripts.
- Added a catalog search page at `/search` and replaced the redundant `Topics` navigation item with `Search`.
- Added Prev/Next pagination to `/search` (20 results per page) with URL-driven `page` params.
- Added an in-app `/digest` page ("New for you"): a scannable, topic-grouped list of the 10 most relevant recent papers (last 7 days, widening to 14/30 when sparse), distinct from the swipe-based feed. Added a Digest nav item and moved mobile Settings access to a header gear icon.
- Added private per-paper notes on the paper detail page (`paper_notes` table, timestamped sequential note log per paper, optional playlist link), with add/delete server actions and RLS.
- Improved paper detail metadata: added a compact Details section (source, access status, venue, year, citations, DOI) shown only when present.

### Fixed

- Made mobile deck gestures responsive to viewport width, disabled competing
  drag momentum, and rendered the real next paper beneath the active card so
  committed and consecutive swipes no longer expose a blank transition.
- Made manual notification-retention dispatches count-only by default, while
  preserving real deletion for explicitly approved runs and the separately
  gated daily schedule.
- Restored the standalone `supabase/schema.sql` research-group lifecycle that
  had drifted behind its deployed migrations and Drizzle model, then verified
  the repaired snapshot from an empty Supabase PostgreSQL 17.6 database.

- Replaced the retired GitHub Models default in scheduled summary generation
  with stable Gemini 3.5 Flash, using native schema-constrained JSON, minimal
  thinking, a larger output budget, and diagnostics that never log malformed
  model output.
- Stopped the first service worker installation from being announced as a new app version while preserving the refresh prompt for genuine updates.
- Prevented semantic candidate starvation by raising the IVFFlat RPC probe count from one to ten, regenerating nearly exhausted cached batches, and filling short post-filter semantic decks from the deduplicated catalog with candidate provenance persisted across cache reads.
- Kept current favorites and Read later items out of the active deck even when their historical interaction rows are absent, and advanced the local deck before opening a paper so browser Back does not restore an already-opened sequence.

- Expanded PWA cache coverage to visit authenticated HTML and request RSC data before proving that neither response enters Cache Storage.
- Made summary generation fall back from an absent dedicated GitHub Models token to the automatic Actions token, and stopped all-failed summary batches from reporting a false-success workflow.
- Made scheduled arXiv ingestion tolerate shared-runner rate limits by honoring `Retry-After`, using minute-scale exponential backoff with jitter for HTTP 429, and preserving structured failure diagnostics in GitHub job summaries.
- Restored meaningful block/discovery coverage after the opt-in default change and expanded friendship tests for idempotent decline/block/unblock, bidirectional blocking, outsider denial, and direct-write rejection.
- Hardened the live Clerk/Supabase RLS smoke test so every successfully created temporary session is tracked immediately, cleanup failures fail the test, and missing-user errors never expose configured email identifiers.
- Moved the mobile PWA update prompt below the header so it no longer blocks bottom navigation, feed actions, or settings controls.
- Ensured legacy accounts synchronize a public collaboration identity before sending a friend request, preventing requests that could not be rendered in the recipient's Connections inbox.
- Hardened scientific-text rendering for common arXiv LaTeX delimiters (`\\(...\\)`, `\\[...\\]`, `$...$`, and `$$...$$`), escaped dollars, and unbalanced delimiters without weakening HTML escaping.
- Made settings interest edits explicit and recoverable: changes remain local until saved, concurrent toggles are blocked during persistence, failures restore the last confirmed selection, and users see an actionable error.
- Centralized authenticated navigation links with prefetch disabled by default, preventing background RSC requests from dynamic user-specific routes.
- Feed cards now receive real recommendation impression IDs, so their dismiss, favorite, Read later, and open-detail actions retain ranking attribution.
- `Already read` now contributes the same positive feedback weight as `read` to both feed ranking and the user profile embedding.
- Fixed `npm run issues:import` creating issues with a literal `-` body: the script now uses `gh --body-file -` (piped stdin) instead of `--body -`.
- Swipe-right save-to-Read-later now awaits the mutation and rolls back the card on failure, matching the dismiss path (no more silent data loss).
- Wrapped `saveSelectedTopics` (delete + insert + profile update) in a transaction so interrupted onboarding can no longer wipe interests.
- Made playlist reordering atomic and batched (single `CASE` update) and fixed the next-position race on add via a `FOR UPDATE` lock.
- Scoped per-paper note deletion to its paper, not just owner + note id.
- Made favorites and Read later ordering deterministic (favorites by newest; Read later by added date as a stable tie-breaker).
- Stopped fabricating the current year for papers with a missing year; `year` is now optional and hidden in the UI when absent.
- Generalized the misleading `requirePaperId` form helper to `requireFormId(field)` and renamed the playlist hidden inputs to `playlistId`.
- Removed the N+1 playlist-item queries on the library page (single batched query).
- Scheduled the paper summary workflow twice daily (05:37 and 17:37 UTC) so summary generation keeps pace with nightly arXiv ingestion.
- Fixed the arXiv ingestion workflow `Summary` step failing with `jq: Cannot iterate over string` (exit 5) by rewriting the summary formatter in Python; ingestion itself was succeeding but the run was marked failed.
- Reduced `/feed` refresh cost by reusing the already-loaded feed state, caching short-lived live recommendation batches, and clearing cached feed batches when interests change.
- Reduced favorite and Read later deck mutation round trips by replacing preflight SELECTs with insert-on-conflict toggle flows.
- Kept the mobile feed card action row and `Read online` link above the bottom navigation.
- Simplified the feed sidebar by removing Mix, expanding Up next to five papers, matching its height to the main card, replacing the header `PD` block with the app mark, replacing feed green/blue accents with onboarding teal, hiding the feed card venue/category line, and tightening vertical spacing so the feed card leaves bottom margin.
- Aligned stale unit tests with the current 50-paper feed batch, `paperdeck-initial-feed-v2`, five-minute batch TTL, classic bonus, and feed-hidden favorite/save behavior.

## [0.1.5] - 2026-07-06

### Added

- Feed deck now loads more papers when the queue drops below 3 visible cards.
- Swipe gestures with card stacking, visual affordances (✕ dismiss, Bookmark save), and exit animations.
- Triage-deck product positioning and guardrails in README.md and ROADMAP.md.
- Markdown-to-GitHub-issues importer (`npm run issues:import`).
- Repository boundary audit: all 36 repository functions tagged `@user-scoped` or `@admin`.
- `owner-guard.ts` utility for defense-in-depth owner id validation.
- `enrich-missing-abstracts.ts`: backfills paper abstracts from arXiv, Semantic Scholar, and OpenAlex.
- `import-paraphrased-abstracts.ts`: imports manually curated paper descriptions from JSON.
- Cover image for onboarding wizard.
- Security headers in `next.config.ts` (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy).
- Concurrency groups on all 5 GitHub Actions workflows.
- `$$...$$` display math support in KaTeX renderer.
- `typecheck` and `test` npm scripts.
- Recommendation impressions table and feed instrumentation.
- Authorization and mutation regression tests (40 unit tests, E2E mutations spec).

### Fixed

- `profiles_select_own` and `profiles_update_own` RLS policies now have proper `using`/`withCheck` clauses.
- Deck API error messages no longer leak internal details in production.
- External paper links use `rel="noreferrer noopener"`.
- Feed deck PaperCard/PlaylistPapers keys include state to force remount on prop changes.
- Playlist creation form stays visible until server action succeeds (race condition fix).
- Embedding model aligned across SQL function, TypeScript constant, and ROADMAP (all MiniLM).
- `user_paper_interactions` now has unique constraint on `(owner_id, paper_id, action)`.
- Playlist navigation uses Next.js `<Link>` instead of full-page `<a>`.
- Playwright mobile viewport project added (skipped in CI to avoid DB race).
- Profile embedding refreshed asynchronously after every deck/feedback mutation via `after()`.
- arXiv ingestion hardened with retry/backoff (429/5xx), cursor tie-breaking by arxiv_id.
- Classic paper discovery now prefers papers with abstracts (requests 3x, sorts abstract-first).
- All 633 catalog papers now have abstracts (23 recovered from APIs, 9 imported as paraphrased).
- CI workflows now write structured markdown job summaries.
- `aria-label` moved from icons to their wrapping buttons.
- `paperFromRow` no longer falsely marked `async`.
- `tsconfig.json` target raised to ES2020.
- Database connection pool default raised to 3.
- `poweredByHeader` disabled.

### Removed

- 7 classic papers without abstracts (all books/treatises with no retrievable abstract).

## [0.1.4] - 2026-07-02

### Added

- Custom private playlists with create, rename, delete, and add/remove paper support.
- Drag-and-drop playlist paper ordering via @dnd-kit with optimistic reorder.
- API route `POST /api/deck` for lightweight deck mutations (dismiss, favorite, read_later).
- Secret rotation checklist for Clerk, Supabase service-role credentials, Google OAuth, and GitHub Actions secrets.
- Repeatable service-role audit command to verify server-only Supabase access boundaries.
- Lightweight Playwright smoke test suite for core authenticated routes under local dev auth.
- Structured feed logs for semantic retrieval decisions, candidate counts, model name, and fallback reason.
- Architecture diagrams covering runtime flow, batch workers, data model, security boundaries, and ranking inputs.
- Multi-category arXiv ingestion verified across all 10 default CS categories (447 papers, 0 duplicates).
- Historical arXiv backfill mode with `--backfill` and `--backfill-pages` flags.
- Separate backfill cursors (`arxiv_backfill:<category>`) for resume support.
- Semantic Scholar enrichment script (`scripts/enrich-semantic-scholar.ts`): citation counts, venue corrections, DOIs, and S2 IDs for 277 papers.
- OpenAlex enrichment script (`scripts/enrich-openalex.ts`): venue, open access status, topics, and abstracts for 11 DOI-backed papers.
- Unpaywall enrichment script (`scripts/enrich-unpaywall.ts`): legal OA URLs stored for 21 papers.
- New npm scripts: `enrich:semantic-scholar`, `enrich:openalex`, `enrich:unpaywall`.
- New environment variables for enrichment workers in `.env.example`.
- OpenAlex taxonomy topics (28 created) linked via `paper_topics` with confidence scores.

### Changed

- Normalized embedding documentation, roadmap status, schema comments, semantic retrieval filtering, remote embedding rows, and GitHub Actions cache naming around the MiniLM model decision.
- ROADMAP.md implementation status updated to reflect completed ingestion and enrichment pipeline.
- docs/ingestion.md expanded with backfill mode and all three enrichment worker sections.
- TASKS.md #10-#14 marked as completed.

## [0.1.3] - 2026-07-01

### Added

- First real BGE-small embedding smoke batch written to Supabase: 2 topic vectors and 1 paper vector.
- Verification notes for the local `uv run --with-requirements requirements-embeddings.txt` embedding path.
- Offline embedding benchmark plan for BGE-small, E5-small-v2, and MiniLM.

### Changed

- Project package version advanced from `0.1.2` to `0.1.3`.
- Embedding documentation updated with the first real batch result and model comparison plan.

## [0.1.2] - 2026-07-01

### Added

- Topic embedding worker with Supabase REST candidate selection, dry-run mode, and `topic_embeddings` upserts.
- Shared Python embedding worker utilities for Supabase REST access, hashing, vector formatting, and model loading.
- GitHub Actions embedding workflow step for topic vectors before paper vectors.

### Changed

- Project package version advanced from `0.1.1` to `0.1.2`.
- Embedding documentation updated to describe topic embedding generation and dry-run commands.

## [0.1.1] - 2026-07-01

### Added

- Server-side user profile embedding aggregation from stored topic and paper vectors.
- Feed refresh of stored user profile embeddings before pgvector semantic retrieval.
- Stale user profile embedding cleanup when no current source vectors are available.

### Changed

- Project package version advanced from `0.1.0` to `0.1.1`.
- README and embedding/database docs updated with the current semantic retrieval implementation status.

## [0.1.0] - 2026-07-01

### Added

- Production deployment on `paperdeck.michaelpiccirilli.it`.
- Clerk production setup with custom domain DNS, SSL, and Google OAuth login.
- Supabase service-role server client and repository layer for MVP persistence.
- Seed catalog persistence for initial topics and starter papers.
- Persistent onboarding interests, favorites, default `Read later`, playlist items, and paper interactions.
- Feed, library, settings, and paper detail pages wired to server-side Supabase data.
- MVP feed ranking from selected topics, hierarchical topic affinity, recent feedback, and seen-paper penalties.
- Toggle behavior for the default `Read later` playlist from feed/detail pages.
- Library removal action for `Read later` items.
- Paper detail actions for `Already read` and `Not interested` ranking signals.
- arXiv ingestion script and GitHub Actions workflow for daily/manual metadata import.
- Incremental arXiv category cursors stored in Supabase.
- arXiv import deduplication by normalized arXiv ID across categories.
- Ingestion documentation with required secrets, local dry-run command, and arXiv API constraints.
- Embedding and ranked retrieval workflow specification in `docs/embeddings.md`.
- Embedding schema migration, Python embedding worker dry-run, and GitHub Actions embedding workflow.
- pgvector paper matching RPC and feed-side semantic candidate fallback.

### Changed

- Project package version advanced from `0.0.0` to `0.1.0`.
- README updated to reflect the current MVP foundation instead of only the initial scaffold.

## [0.0.0] - 2026-07-01

### Added

- Initial product roadmap for PaperDeck.
- Public README with project description, MVP scope, planned data sources, ranking approach, and architecture.
- SVG logo under `logo/paperdeck-logo.svg`.
- Session log folder with `sessions/SESSION1.md`.
- Agent guidance in `AGENT.md`.
- Next.js scaffold with TypeScript, App Router, Tailwind, and ESLint.
- Initial PaperDeck app shell replacing the default Next.js starter screen.
- Route skeleton for feed, onboarding, library, settings, and paper detail views.
- Shared UI components for the app shell, bottom navigation, paper cards, and paper list items.
- Mock paper, topic, playlist, and user interest data.
- TypeScript domain types for papers, topics, playlists, and interactions.
- Clerk SDK integration with provider, protected app routes, auth pages, and `.env.example`.
- Supabase database plan and initial SQL schema with pgvector, ownership columns, indexes, and future RLS policies.
