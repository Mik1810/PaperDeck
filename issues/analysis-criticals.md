---
## Fix RLS policies on profiles table in Drizzle schema
labels: area:security, area:database, priority:p0, type:bug

**File:** src/db/schema.ts:17-19

The policies `profiles_select_own` and `profiles_update_own` are defined without `using`/`withCheck` clauses in the Drizzle ORM schema. If `drizzle-kit push` is run, any authenticated user can read and modify any profile row.

In `supabase/schema.sql`, the same policies correctly include `using (owner_id = auth.jwt() ->> 'sub')`.

**Fix:** Add `using(sql`owner_id = auth.jwt() ->> 'sub'`)` and `withCheck` to both policies in `schema.ts`.

---
## Sync optimistic state with props in paper-card and playlist-papers
labels: area:frontend, area:feed, priority:p1, type:bug

**File:** src/components/paper-card.tsx:41-42, src/components/playlist-papers.tsx:29

`useState(isFavorite)` and `useState(isSaved)` are initialized from props but never updated when props change (e.g., after `revalidatePath` on navigation). If the user navigates away and returns, stale local state overrides actual server state.

**Fix:** Add `useEffect` to sync local state with props:
```ts
useEffect(() => setOptimisticFavorite(isFavorite), [isFavorite]);
useEffect(() => setOptimisticSaved(isSaved), [isSaved]);
```

---
## Race condition in playlist creation: form hidden before server action completes
labels: area:frontend, priority:p1, type:bug

**File:** src/components/playlist-sidebar.tsx:48

`onSubmit={() => setIsCreating(false)}` hides the create form before the server action completes. If creation fails, the form disappears with no user feedback and no way to retry.

**Fix:** Only reset `setIsCreating(false)` after successful server action, or use `useActionState` for proper form state management.

---
## Leak internal error messages in API response
labels: area:security, area:backend, priority:p1, type:bug

**File:** src/app/api/deck/route.ts:50

`error.message` is exposed directly in the 500 JSON response. In production, this leaks internal implementation details to the client.

**Fix:** Return generic `"Internal error"` in production, only expose details in development.

---
## Missing noopener on external paper links
labels: area:security, area:frontend, priority:p1, type:bug

**File:** src/components/paper-card.tsx:211

External links use `rel="noreferrer"` without `noopener`, allowing the target page to access `window.opener`. This is a security best-practice gap.

**Fix:** Change to `rel="noreferrer noopener"`.

---
## Embedding model mismatch: three different sources of truth
labels: area:embeddings, area:architecture, priority:p1, type:bug

**File:** supabase/schema.sql:404, src/lib/repositories/user-profile-embeddings.ts:28, ROADMAP.md:20

The default embedding model is inconsistent across the codebase:

- `match_papers_by_embedding` SQL function default: `sentence-transformers/all-MiniLM-L6-v2`
- TypeScript constant `EMBEDDING_MODEL`: `sentence-transformers/all-MiniLM-L6-v2`
- ROADMAP.md: `BAAI/bge-small-en-v1.5`

**Fix:** Align all three sources on a single model and document the decision.

---
## Missing unique constraint on user_paper_interactions preventing duplicate rows
labels: area:database, area:backend, priority:p1, type:bug

**File:** supabase/schema.sql, src/db/schema.ts

`user_paper_interactions` has no unique constraint on `(owner_id, paper_id, interaction_type)`. Every call to `recordPaperInteraction` inserts unconditionally, creating potential duplicates. The missing composite index on `(owner_id, paper_id)` also causes full index scans for point lookups in `toggleFavorite`, `getPaperDetailState`, and feed deduplication.

**Fix:** Add unique index on `(owner_id, paper_id, interaction_type)` and composite index on `(owner_id, paper_id)`.

---
## Replace full-page anchor with Next.js Link in playlist sidebar
labels: area:frontend, area:performance, priority:p1, type:bug

**File:** src/components/playlist-sidebar.tsx:119-121

Raw `<a href={...}>` causes full page reloads when navigating between playlists. Should use Next.js `<Link>` for client-side navigation.

---
## Add mobile viewport to Playwright test config
labels: area:frontend, area:ci, priority:p1, type:test

**File:** playwright.config.ts:52-53

The app is mobile-first but Playwright only tests on Desktop Chrome at 1280x720. There is no mobile viewport project (e.g., `Pixel 5` or `iPhone 14`). Auth tests are also always skipped in CI because `PAPERDECK_E2E_DEV_AUTH=true` skips the Clerk-dependent test suite.

**Fix:** Add a mobile device project and configure a CI matrix or separate job that runs auth tests without dev auth.
