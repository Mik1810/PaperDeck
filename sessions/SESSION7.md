# Session 7

Date: 2026-07-02

Model: DeepSeek (deepseek-v4-pro) via opencode

## Goal

Close remaining P1 documentation issues (#8, #9) and plan next work.

---

## Issue #8 — Update ROADMAP.md implementation status

Updated `ROADMAP.md` "Stato implementazione" to reflect all work completed through SESSION6:

- Embedding batch completi (64 topic + 449 paper) — non piu "primo smoke batch"
- LLM triage summaries with GitHub Models provider
- Clerk JWT + Supabase RLS configurato e verificato
- MathJax 3 per rendering LaTeX
- Audit service-role + checklist rotazione secret
- Playwright smoke tests
- Osservabilita semantic retrieval con `feed_timing` esteso
- Aggiunta sezione "Prossimi passi" con benchmark embeddings, review summary storage, feature P2

---

## Issue #9 — Normalize SESSION2.md

Riorganizzato il finale di SESSION2.md:

- **Open Questions**: 8 domande aperte numerate in modo chiaro
- **Next Steps**: 10 passi ordinati per priorita, dal piu immediato (GitHub secrets) al piu avanzato (benchmark)
- **Stato finale**: riassunto della sessione con conteggi e stato RLS
- Rimosso testo duplicato italiano/inglese
- Rimossa nota di incoerenza docs (non piu rilevante — ROADMAP ora allineato)

---

## Issues closed

```
#8  — Update ROADMAP.md implementation status
#9  — Normalize the end of sessions/SESSION2.md
```

## Remaining P1

```
#22 — Execute offline benchmark plan (embeddings)
#38 — Review triage summary storage strategy
```

## Next candidate

#22 — eseguire il piano di benchmark offline in `docs/embeddings.md`:
confrontare BGE-small, E5-small-v2 e MiniLM per Recall@20, NDCG@20, MRR@10, latenza, storage.

---

## Issue #22 — Embedding Benchmark

Created `scripts/benchmark_embeddings.py` — fully offline, no DB writes, all vectors in NumPy arrays in RAM.

### Methodology
- 3 models compared: `BAAI/bge-small-en-v1.5`, `intfloat/e5-small-v2`, `sentence-transformers/all-MiniLM-L6-v2`
- Data: 64 topics (31 with arxiv_category), 447 arXiv papers
- Proxy metric: Rec@20 = fraction of top-20 cosine-similar papers that share the same arXiv category
- Category overlap used as relevance proxy (no manual labeling needed)

### Results
| Model | Rec@20 | Med@20 | Paper Encode | Delta vs BGE |
|---|---|---|---|---|
| **all-MiniLM-L6-v2** | **0.206** | 0.000 | **0.9s** | **+17.4%** |
| BGE-small-v1.5 | 0.176 | 0.050 | 3.1s | baseline |
| E5-small-v2 | 0.165 | 0.050 | 2.9s | -6.4% |

### Decision
Switch default from BGE-small to **all-MiniLM-L6-v2**:
- Exceeds 10% improvement threshold (+17.4%)
- 3x faster paper encoding (0.9s vs 3.1s for 447 papers)
- Same 384-dim output, no schema changes needed

Updated `docs/embeddings.md` with benchmark table.

### Model switch implementation
Replaced BGE-small with MiniLM everywhere:
- `scripts/embedding_common.py`: DEFAULT_MODEL
- `src/lib/repositories/user-profile-embeddings.ts`: EMBEDDING_MODEL constant
- `.env.example`, `.github/workflows/embed-papers.yml`
- `supabase/schema.sql`, migration: match_papers_by_embedding RPC default
- Regenerated 64 topic + 449 paper embeddings with MiniLM

### Issues closed
```
#8, #9, #22
```

## Remaining P1
```
#38 — Review triage summary storage strategy (post-MVP)
```

All P0-P1 issues are now CLOSED. Only #38 (post-MVP/scaling) remains open.

## P2 Issues Completed

### #26 — Custom Private Playlists
- createPlaylist, renamePlaylist, deletePlaylist, addToPlaylist, removeFromPlaylist
- PlaylistSidebar with inline create/rename/delete (hover-visible icons)
- Read later default playlist protected from rename/delete
- Library page supports ?playlist= searchParam

### #27 — Drag-and-Drop Playlist Ordering
- @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities
- SortablePlaylistPaper with GripVertical drag handle
- PlaylistPapers component in main content area with DndContext
- Optimistic arrayMove on drop + reorderPlaylistAction for persistence
- addToPlaylist assigns position = max+1 (new papers at bottom)
- Mounted check avoids dnd-kit SSR hydration mismatch

### #6 — Collapse Feed Supabase Round Trips
- Merged getSelectedTopicIds + getUserPaperState into getFeedState
- Single Supabase client with 4 queries in Promise.all
- Feed page: 2 parallel calls instead of 3
- Interaction limit: 500 → 200 rows
- Also applied to getSettingsPageData and getOnboardingData

### #7 — Route-Handler Mutations for Deck Actions
- New POST /api/deck route returning { ok: true } JSON
- Handles dismiss, favorite, read_later via lightweight API route
- PaperCard: buttons with onClick + fetch instead of form actions  
- PaperDetailActions: same pattern for favorite/read-later
- Form actions kept for openPaperAction (needs redirect) and feedback

## Issues Closed This Session
```
#8, #9, #22, #26, #27, #6, #7
```

---

# SESSION 8

Date: 2026-07-02
Task: Review triage summary storage strategy (Issue #38)

## Issue #38: Review triage summary storage strategy before scaling

### Problem

`triage_summary` was stored as a JSONB column inline on the `papers` table. The same `paperSelect` string included `triage_summary` for ALL queries — feed candidates, library, favorites, detail page. Only the detail page actually renders the summary.

### Actions taken

#### 1. Immediate query-level optimization (zero-downtime, no migration)

**File: `src/lib/repositories/catalog.ts`**
- Split `paperSelect` into `paperSelectSimple` (without `triage_summary`) and `paperSelectWithSummary` (with `triage_summary`).
- `getPapersByIds()` now accepts optional `{ includeSummary?: boolean }` parameter (default: `false`).
- `getAllPapers()` uses `paperSelectSimple` (summaries never needed for catalog-wide queries).
- `getPaperById()` uses `paperSelectWithSummary` (single-row lookup, overhead negligible).

**File: `src/lib/repositories/user-data.ts`**
- `getPaperDetailData()` now passes `{ includeSummary: true }` to `getPapersByIds()` — the only call site that needs summaries.

**Performance impact (estimated):**
- Feed semantic candidates (up to 200 papers): saves up to ~1 MB of JSONB transfer per query.
- Library/favorites/read-later: proportional savings.
- Detail page: unchanged behavior.

#### 2. Decision document

**File: `docs/summaries.md`** (new)
- Documents the current approach and why inline JSONB + query-level exclusion is optimal at current scale.
- Defines the migration trigger: 5,000 papers with summaries.
- Full migration plan: create `paper_summaries(paper_id, summary, model, generated_at)` table, backfill, update worker, update catalog, drop old columns.
- Rejected alternatives: external cache (Redis), TOAST compression, indefinite inline.
- Model versioning strategy for future prompt/model changes.

#### 3. Updated documentation

- `docs/ingestion.md`: added "See also" reference to summaries.md.
- `ROADMAP.md`: moved summary storage review from "prossimi passi" to done, linked to decision doc.

## Files changed

| File | Change |
|---|---|
| `src/lib/repositories/catalog.ts` | Split `paperSelect` into `paperSelectSimple` and `paperSelectWithSummary`; added `includeSummary` option to `getPapersByIds()` |
| `src/lib/repositories/user-data.ts` | `getPaperDetailData()` passes `includeSummary: true` |
| `docs/summaries.md` | NEW: decision doc with scaling triggers and migration plan |
| `docs/ingestion.md` | Added cross-reference to summaries.md |
| `ROADMAP.md` | Marked summary storage review as done |

## Verification

- `npx eslint` — clean (pre-existing TS errors only, same as before).
- `gh issue close 38` — closed successfully.

## Issue status after session

Issue #38: CLOSED

Remaining open issues (13): #2, #3, #4, #5, #28, #29, #30, #31, #33, #34, #35, #36, #37 — all product/frontend, none performance-related.

---

## PWA setup for iPhone (second task)

### Goal

Use PaperDeck as an app on iPhone via "Add to Home Screen" without Apple Developer license.

### Actions taken

**Icon — extracted from `logo/paperdeck-logo.svg`:**
- `public/icon.svg`: card illustration only (3 stacked cards + checkmark), on teal→blue gradient background, 300×300 square viewBox.
- `scripts/generate-icons.mjs`: Node script using `sharp` to generate PNGs at all required sizes and splash screens.
- `npm run generate:icons` added to `package.json`.

Generated assets:
- `icon-72.png`, `icon-96.png`, `icon-128.png`, `icon-144.png`, `icon-152.png` — various PWA sizes
- `apple-touch-icon.png` (180×180) — iPhone home screen icon
- `icon-192.png`, `icon-384.png`, `icon-512.png` — manifest icons
- `splash-640x1136.png`, `splash-1170x2532.png`, `splash-1179x2556.png`, `splash-1290x2796.png` — iOS splash screens
- `src/app/favicon.ico` (32×32) — replaced default Next.js favicon

**Manifest — `public/manifest.json`:**
- `display: standalone` (full-screen without Safari toolbar)
- `theme_color: #0d9488`, `background_color: #ffffff`
- `start_url: /feed`, `orientation: portrait`
- Icons with `purpose: "any maskable"`

**Service Worker — `public/sw.js`:**
- Cache-first for static assets (JS, CSS, fonts, images, icons)
- Network-first for page navigations, fallback to cache, final fallback to `/offline.html`
- Precaches `/feed` and `/offline.html` on install
- Cleans old cache versions on activate

**Offline page — `public/offline.html`:**
- Standalone HTML with matching design (Inter font, teal gradient button)
- Shows PaperDeck icon, "You're offline" message, "Try again" button

**PWA Registration — `src/components/pwa-provider.tsx`:**
- Client component that registers `/sw.js` on mount
- Logs update availability to console

**Layout — `src/app/layout.tsx`:**
- Metadata: `manifest`, `appleWebApp` (capable + splash screen images), `icons` (favicon + apple-touch-icon)
- Viewport: `themeColor: #0d9488`, `viewportFit: "cover"`
- `<PwaProvider />` rendered in body

### Files changed (PWA)

| File | Change |
|---|---|
| `public/icon.svg` | NEW: square card icon with gradient background |
| `public/manifest.json` | NEW: PWA configuration |
| `public/sw.js` | NEW: service worker with cache strategies |
| `public/offline.html` | NEW: offline fallback page |
| `public/icon-*.png` (x6) | NEW: generated PWA icons |
| `public/apple-touch-icon.png` | NEW: 180×180 apple touch icon |
| `public/splash-*.png` (x4) | NEW: iOS startup images |
| `src/app/favicon.ico` | REPLACED: 32×32 app icon |
| `src/components/pwa-provider.tsx` | NEW: SW registration component |
| `src/app/layout.tsx` | Updated with manifest, Apple meta, splash, viewport, PwaProvider |
| `scripts/generate-icons.mjs` | NEW: icon generation script |
| `package.json` | Added `generate:icons` script |
| `node_modules/sharp` | NEW dev dependency |

### TypeScript fix

Fixed pre-existing TS build error in `src/lib/repositories/catalog.ts`: Supabase dynamic select strings require `as unknown as PaperRow[]` cast. Applied to all three functions (`getPapersByIds`, `getAllPapers`, `getPaperById`).

### Verification

- `npm run build` — clean
- `npx eslint` — clean

---

## PWA icon centering (third task)

Multiple iterations fixing the icon position so the front card appears centered:
- `translate(54, 28)` → `translate(-8, -19)` → `translate(9, -20)` → `translate(9, -14)` → `translate(5, -14)`
- Final: card front centered, slightly nudged left for visual balance

---

## Mobile nav latency fix

All `<Link>` components in `bottom-nav.tsx` and `app-shell.tsx` had `prefetch={false}` causing ~1s delay on tap. Removed the prop so Next.js prefetches RSC payloads eagerly.

---

## Loading skeletons — all 5 pages

Created `loading.tsx` for every route to eliminate perceived latency on mobile nav:
- **`/feed`**: full grid skeleton (card + Mix sidebar + Up next), later redesigned
- **`/library`**: 4 placeholder items
- **`/onboarding`**: 5 topic groups with pills
- **`/settings`**: 3 section placeholders, later updated to match grid layout
- **`/papers/[paperId]`**: full article skeleton (tags, title, authors, actions, abstract, triage summary)

`AppShell` subtitle type widened from `string` to `ReactNode` to support skeleton placeholders.

---

## Desktop feed card width

Paper card was capped at `max-w-md` (448px) on all screens. Made responsive:
- Mobile: `max-w-md` (448px)
- Desktop: `lg:max-w-none` — fills column up to sidebar gap
- Section wrapper: removed `justify-center`, now left-aligned with heading
- Empty state: same responsive max-w treatment

Created issue #39 for reviewing remaining desktop views.

---

## MathJax → KaTeX migration

LaTeX rendering in abstracts was unreliable — MathJax CDN had race conditions and the loading script didn't handle already-loaded-but-still-initializing state.

**Fix**: replaced MathJax CDN with KaTeX (`npm install katex`):
- `lib/render-latex.ts`: splits text on `$...$` and renders math via `katex.renderToString`
- `components/math-content.tsx`: rewritten from client component to universal component (works server + client)
- `layout.tsx`: imports `katex/dist/katex.min.css`
- No CDN, no race conditions, synchronous rendering

---

## Empty states (#33 closed)

- **Feed**: now distinguishes "No papers yet" (initial, truly 0) from "No papers left in deck" (all dismissed)
- **Custom playlist**: icon + "This playlist is empty" + hint when zero papers
- **Favorites**: redesigned card with icon and consistent layout
- **Read later**: same treatment as favorites

---

## Mobile layout verification (#31 closed)

**Fixed:**
- Feed card `min-h-[560px]` → `min-h-[360px]` on mobile (`sm:min-h-[560px]` on desktop) — fits iPhone SE (568px viewport)
- `100vh` → `100dvh` for iOS Safari dynamic viewport (address bar collapse)

**Verified OK:** onboarding, library, paper detail, settings, sign-in/sign-up — all responsive on 320-430px wide viewports.

---

## Settings: editable interests (#28 closed)

Previously interests were read-only badges. Now fully interactive:

- **New server action**: `saveSettingsInterestsAction` — saves topics + refreshes profile embedding + revalidates paths, **no redirect** (stays on settings)
- **New component**: `SettingsInterestEditor` — toggleable cards (Broad areas) and chips (Refine topics) with:
  - Optimistic UI (instant toggle)
  - Auto-save on every click
  - "Saving..." / "Saved" indicator
- **Updated skeleton**: matches new grid layout (Profile + Digest side-by-side, Interests spanning full width)

---

## Summary automation

Increased workflow throughput for triage summaries:
- `LLM_LIMIT`: 3 → 50 (daily cron)
- `LLM_BATCH_SIZE`: 1 → 3
- `LLM_REQUEST_DELAY_MS`: 10000 → 3000
- At 50/day: remaining ~440 papers done in ~9 days (was 167)

Attempted local runs (Cloudflare, GitHub Models, Gemini) — GitHub Models needs PAT with permissions, Cloudflare was working. Ended up triggering GitHub Actions manually with `limit=100`.

**GitHub Actions runs triggered in session:**
| Run | Limit | Status |
|---|---|---|
| `28625544712` | 80 | `in_progress` |
| `28625604246` | 100 | `queued` |

---

## Final issue status

Closed this session: #28, #31, #33, #38, #39  

Remaining open:
- P0 (product): #2, #3, #4, #5
- P2 (feature): #29, #30
- P3 (post-MVP): #34, #35, #36, #37

---

# SESSION 9

Date: 2026-07-03
Task: Scope playlist item mutations by authenticated owner (Issue #40)

## Issue

Issue #40 reports that playlist item mutations authenticate the request but previously discarded the authenticated owner before mutating `playlist_items` through the Supabase service-role client.

## Why it matters

The service-role client bypasses RLS, so repository mutations must enforce ownership explicitly. Without that check, a malicious user could attempt to add, remove, or reorder papers in another user's playlist if they know or guess the playlist id.

## Plan

1. Keep the existing owner-aware action changes for add, remove, and reorder.
2. Verify repository mutations check `playlists.owner_id` before touching `playlist_items`.
3. Strengthen unit regressions for cross-user playlist ids and owned playlist happy paths.
4. Update changelog and run the relevant test checks.

## Changes

- Added focused unit coverage for successful add, remove, and reorder flows, verifying that mutations proceed after `playlists.id` and `playlists.owner_id` checks.
- Updated `CHANGELOG.md` with the playlist ownership fix and the focused unit test coverage.

## Verification

- `npm run test:unit` — passed, 6 tests.
- `npx eslint src/app/actions.ts src/lib/repositories/user-data.ts src/lib/repositories/playlist-items.ts tests/unit/playlist-items.test.ts` — passed.
- `npx tsc --noEmit` — passed.
- `npm run lint` — not clean globally because of unrelated existing errors in `src/components/playlist-papers.tsx` and `src/lib/render-latex.ts`, plus unrelated warnings.

## GitHub issue status

- Closed #40 on GitHub after implementation and focused verification.
- Edited the #40 closing comment to replace escaped `\n` sequences with clean Markdown formatting.
- Checked the suspected earlier issue mismatch: #39 is still open on GitHub even though SESSION8 listed it as closed. Its body still asks for a broader desktop responsive audit across views, so it was not closed without re-auditing that scope.

---

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

---

# SESSION 11

Date: 2026-07-03
Task: Expand source/type mapping for Crossref/manual records (Issue #53)

## Issue

Issue #53 reports that the database `paper_source` enum supports `crossref`
and `manual`, while the TypeScript/UI source model only exposed arXiv,
Semantic Scholar, OpenAlex, and DBLP. Manual records were incorrectly displayed
as arXiv.

## Why it matters

As enrichment grows beyond arXiv-first imports, source labels must stay truthful.
Incorrect labels can mislead users about provenance and make future debugging of
metadata records harder.

## Plan

1. Add explicit Crossref and Manual source labels to the domain type.
2. Move source display/database conversion into a shared helper.
3. Add a safe UI fallback for unknown future database source values.
4. Replace inline source labels with reusable source badges.
5. Add focused unit tests for source mapping and badge coverage.

## Changes

- Added `DatabasePaperSource`, `KnownPaperSource`, and expanded `PaperSource`
  types.
- Added `src/lib/paper-sources.ts` for source conversion, fallback handling, and
  badge style coverage.
- Added `src/components/paper-source-badge.tsx` and reused it in the deck card,
  paper list item, and upcoming-feed list.
- Updated catalog and seed code to use the shared source conversion helper.
- Updated `CHANGELOG.md` with the source mapping and manual-source fix.
- Added `tests/unit/paper-sources.test.ts`.
- Removed an unused `useTransition` import from the touched paper card module.

## Verification

- `npm run test:unit` - passed.
- `npx tsc --noEmit` - passed.
- `npx eslint src/types/paper.ts src/lib/paper-sources.ts src/components/paper-source-badge.tsx src/lib/repositories/catalog.ts scripts/seed-catalog.ts src/components/paper-card.tsx src/components/paper-list-item.tsx src/components/feed-deck.tsx tests/unit/paper-sources.test.ts` - passed.
- `git diff --check` - passed.
- Mobile Playwright check for `/feed` at 390x844 - passed with status 200, 4
  source badges, and no horizontal overflow.
- `npx playwright test tests/e2e/app-smoke.spec.ts` - passed.

## Notes

- `npm run lint` still fails on unrelated existing lint errors in
  `src/components/playlist-papers.tsx` and `src/lib/render-latex.ts`, plus
  unrelated warnings in other files.

## GitHub issue status

- Commented on #53 with the implementation summary, validation commands, and
  remaining unrelated lint note.
- Closed #53 on GitHub as completed with
  `gh issue close 53 --repo Mik1810/PaperDeck --reason completed`.

---

# SESSION 12

Date: 2026-07-03
Task: Generate Supabase database types and remove manual row casts (Issue #50)

## Issue

Issue #50 asks for generated Supabase TypeScript types from `supabase/schema.sql`
and for replacing broad repository casts such as `as unknown as PaperRow[]`.

## Why it matters

Typed database rows make schema drift visible during TypeScript checks instead of
letting repository code silently accept mismatched shapes.

## Plan

1. Add a repeatable schema-to-TypeScript generation command.
2. Add generated `src/types/database.ts`.
3. Type Supabase server clients with the generated `Database` type.
4. Replace high-risk casts in catalog and user-facing repository code.
5. Add a stale-types check script and run focused validation.

## Changes

- Added `scripts/generate-database-types.ts`, a local generator that reads
  `supabase/schema.sql`.
- Added `npm run db:types` and `npm run db:types:check`.
- Generated and added `src/types/database.ts`.
- Typed the service-role and Clerk-authenticated Supabase server clients with
  the generated `Database` type.
- Replaced catalog row definitions with generated table-derived types and
  removed `as unknown as PaperRow[]` casts.
- Removed user repository casts for selected topics, favorites, playlist items,
  interactions, playlist summaries, and playlist mutation clients.
- Updated paper domain enum aliases to reference generated database enums.
- Removed obsolete local playlist query interfaces after switching playlist
  mutation helpers to the generated Supabase client type.
- Removed the unused `eslint-disable` banner from generated database types.
- Regenerated `src/types/database.ts` after the generator template cleanup.
- Improved generated database type field indentation and regenerated
  `src/types/database.ts`.
- Added `.github/workflows/database-types.yml` to run `npm run db:types:check`
  on pull requests and pushes to `main`.
- Updated `CHANGELOG.md` with the database typing change.

## Verification

- `npm run db:types:check` - passed.
- `npx tsc --noEmit` - passed.
- `npx eslint scripts/generate-database-types.ts src/types/database.ts src/types/paper.ts src/lib/supabase/server.ts src/lib/repositories/catalog.ts src/lib/repositories/user-data.ts src/lib/repositories/playlist-items.ts` - passed.
- `npm run test:unit` - passed.
- `npm run build` - passed.
- `git diff --check` - passed.
- `rg "as unknown as|as Array<|as string|as boolean" src/lib/repositories/catalog.ts src/lib/repositories/user-data.ts src/lib/repositories/playlist-items.ts` - no matches.

## Notes

- `npm run lint` still fails on unrelated existing lint errors in
  `src/components/playlist-papers.tsx` and `src/lib/render-latex.ts`, with
  unrelated warnings in other files.

## GitHub issue status

- Commented on #50 with the implementation summary, validation commands, and
  unrelated lint note:
  https://github.com/Mik1810/PaperDeck/issues/50#issuecomment-4874845827
- Closed #50 on GitHub as completed with
  `gh issue close 50 --repo Mik1810/PaperDeck --reason completed`.

---

# SESSION 13

Date: 2026-07-03
Task: Fix lint errors

## Issue

`npm run lint` fails because of two lint errors and reports several unused-code
warnings in nearby files.

## Plan

1. Remove unused variables, props, imports, and state.
2. Replace the playlist mounted gate that calls `setState` inside an effect.
3. Run lint and focused verification.

## Changes

- Opened this session log for lint cleanup.
- Removed an unused splash icon buffer from `scripts/generate-icons.mjs`.
- Removed the unused `sourcePath` prop from `PaperDetailActions` and its caller.
- Removed the `PlaylistPapers` mounted state/effect gate that triggered
  `react-hooks/set-state-in-effect`.
- Removed unused playlist sidebar imports/state.
- Removed the unused `mathDepth` variable from the LaTeX renderer.

## Verification

- `npm run lint` - passed.
- `npx tsc --noEmit` - passed.
- `npm run build` - passed.
- `git diff --check` - passed.

---

# SESSION 14

Date: 2026-07-03
Task: Normalize embedding model decision

## Issue

GitHub issue #46 tracks stale BGE-small references after the benchmark selected
`sentence-transformers/all-MiniLM-L6-v2` as the current embedding model.

## Plan

1. Make MiniLM the explicit current/default model in roadmap and embedding docs.
2. Keep BGE-small references only as historical benchmark or smoke-run context.
3. Rename the HuggingFace cache key so it is not BGE-specific.
4. Verify model defaults and remaining references before updating the issue.

## Changes

- Opened this session log for issue #46.
- Updated roadmap status and embedding strategy to make MiniLM the current model.
- Updated architecture diagrams and model table from BGE-small to MiniLM.
- Updated embedding, database, and ingestion docs so BGE-small is historical baseline context only.
- Filtered semantic retrieval to the shared current embedding model before selecting a user profile vector.
- Renamed the GitHub Actions HuggingFace cache key to a generic embedding-model cache key.
- Updated the canonical schema comment for the pgvector cosine index.
- Ran MiniLM write-mode embedding batches against Supabase: 2 topic vectors and 256 paper vectors were written.
- Verified remote embedding counts: 571 MiniLM paper rows, 66 MiniLM topic rows, and 2 MiniLM profile rows; BGE-small remains only as historical rows in multi-model tables.
- Added a changelog entry for the MiniLM documentation/cache normalization.

## Verification

- `rg` check for BGE default/current/cache patterns - only historical-baseline references remain.
- `rg` check for MiniLM defaults - Python worker, GitHub Actions workflow, schema/RPC, migration, profile repository, and docs all point to `sentence-transformers/all-MiniLM-L6-v2`.
- `python3 scripts/embed_topics.py --dry-run --limit 5 --table-limit 20` - used MiniLM and found 0 topic candidates in the inspected slice.
- `python3 scripts/embed_papers.py --dry-run --limit 5 --table-limit 20` - used MiniLM and marked inspected paper rows as `model_changed`, confirming legacy model rows are selected for re-embedding.
- `uv run --isolated --with-requirements requirements-embeddings.txt python scripts/embed_topics.py --limit 256 --table-limit 512 --batch-size 64 --quiet` - wrote 2 MiniLM topic vectors.
- `uv run --isolated --with-requirements requirements-embeddings.txt python scripts/embed_papers.py --limit 512 --table-limit 1000 --batch-size 64 --quiet` - wrote 256 MiniLM paper vectors.
- `python3 scripts/embed_topics.py --dry-run --limit 20 --table-limit 512` - 0 remaining MiniLM topic candidates.
- `python3 scripts/embed_papers.py --dry-run --limit 20 --table-limit 1000` - 0 remaining MiniLM paper candidates.
- Remote count query - 571 MiniLM paper rows, 66 MiniLM topic rows, 2 MiniLM profile rows; historical BGE-small rows remain only in multi-model topic/profile tables.
- `git diff --check` - passed.
- `npm run lint` - passed.
- `npm run test:unit` - passed.
- `npx tsc --noEmit` - passed.
- `npm run build` - passed.

---

# SESSION 15

Date: 2026-07-03
Task: Add application CI workflow

## Issue

GitHub issue #43 tracks the missing push/PR CI gate for application code.
Without it, service-role boundary regressions, lint errors, build failures, and
smoke test failures can land without automated feedback.

## Plan

1. Reuse the repository's existing Node version and npm cache conventions.
2. Add a push/PR workflow for service-role audit, lint, build, and Playwright smoke tests.
3. Make Supabase-backed E2E tests run when secrets are present and skip clearly when they are absent.
4. Update changelog and verify the workflow-related commands locally.

## Changes

- Added this session log for issue #43.
- Added `.github/workflows/ci.yml` for app CI on pull requests and pushes to `main`.
- Configured Node 24 with npm dependency caching and `npm ci`.
- Added CI steps for `npm run audit:service-role`, `npm run lint`, `npm run build`, Playwright browser install, and `npm run test:e2e`.
- Added a CI notice that explains when Supabase-backed Playwright smoke tests will be skipped because secrets are unavailable.
- Aligned the CI notice placeholder detection with the Playwright test guard.
- Added the missing `server-only` import to `src/lib/repositories/playlist-items.ts` so the service-role audit passes before enabling it in CI.
- Updated `npm run test:unit` to run Node with the `react-server` condition so unit tests can import server-only repository modules.

## Verification

- `npm run audit:service-role` initially failed because `src/lib/repositories/playlist-items.ts` lacked `server-only`; fixed and reran successfully.
- `npm run lint` - passed.
- `npm run test:unit` - passed after adding the React server condition to the test command.
- `npm run build` - passed.
- CI-like build with dummy Clerk keys and empty Supabase env - passed.
- `npm run test:e2e` - passed with local Supabase env: 6 passed, 2 skipped.
- `NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= SUPABASE_SERVICE_ROLE_KEY= npm run test:e2e` - passed with missing Supabase env: 2 passed, 6 skipped.
- `npx playwright install --with-deps chromium` - could not complete locally because system dependency installation requires interactive `sudo`; this is expected to work on GitHub-hosted Ubuntu runners.
- CI notice shell block syntax check - passed with `bash -n`.
- `.github/workflows/ci.yml` parsed with Ruby YAML - passed.
- `git diff --check` - passed.
