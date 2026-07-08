# PaperDeck Codebase Analysis

Findings from a codebase review on 2026-07-08. Each block below is parsable by
`npm run issues:import` (`scripts/create-issues.ts`): a `## Title`, an optional
`labels:` line, a `**File:**` reference, and a Markdown body, separated by `---`.

Known/tracked topics (feed latency, deck latency, optimistic rollback, RLS
policies, Supabase types, playlist ordering, service worker caching, etc.) are
intentionally excluded to avoid duplicating existing issues.

---
## Handle errors when swipe-right save-to-read-later fails
labels: type:bug, area:feed, priority:p1

**File:** src/components/feed-deck.tsx:155

A right swipe optimistically dismisses the active paper (`setPaperDismissed(id, true)`) and then calls `submitDeckAction("read_later", ...)` as a fire-and-forget promise: the result is never awaited and errors are never caught. The left-swipe path, by contrast, uses `handleDismissSubmit`, which catches failures and restores the card via `setPaperDismissed(id, false)`.

Consequence: if the Read later API call fails (network error, 500, auth expiry), the paper disappears from the feed but is never saved anywhere — silent data loss from the user's perspective.

**Fix:** Route the right swipe through the same optimistic + rollback pattern as dismiss: await the mutation and restore the card (and surface an error) on failure.

---
## Stop using the current year as a fallback for missing paper year
labels: type:bug, area:backend, priority:p2

**File:** src/lib/repositories/catalog.ts:53

`paperFromRow` returns `year: row.year ?? new Date().getFullYear()`. This makes a pure read non-deterministic: a paper with a null year renders as 2026 today and 2027 next year, and can differ between server render and any later re-render. It also silently fabricates metadata that is then shown as fact on the paper detail and cards.

**Fix:** Make `year` optional on the `Paper` type (`year?: number`) and return `row.year ?? undefined`, letting the UI decide how to render a missing year (e.g. hide it or show "—"). Update consumers accordingly.

---
## Wrap saveSelectedTopics delete-then-insert in a transaction
labels: type:bug, area:database, priority:p1

**File:** src/lib/repositories/user-data.ts:303

`saveSelectedTopics` deletes all of a user's `user_interests` rows and then inserts the new selection in two separate statements with no transaction. If the process crashes or the DB connection drops between the delete and the insert, the user permanently loses every selected interest — which also degrades their feed ranking and onboarding state.

**Fix:** Wrap the delete + insert (and the subsequent profile update) in `db.transaction(async (tx) => { ... })` so the change is atomic.

---
## Make playlist reordering atomic and batched
labels: type:bug, area:database, priority:p2

**File:** src/lib/repositories/playlist-items.ts:83

`reorderOwnedPlaylistItems` issues one `UPDATE` per paper in a sequential loop with no transaction. A failure mid-loop leaves the playlist half-reordered (some items updated, others stale), and a 50-item playlist means 50 round trips.

**Fix:** Wrap the loop in `db.transaction(...)` so positions commit or roll back together. Optionally collapse to a single statement using a `CASE ... WHEN` expression (or `unnest`) to set all positions at once.

---
## Fix race condition when computing next playlist item position
labels: type:bug, area:database, priority:p2

**File:** src/lib/repositories/playlist-items.ts:35

`addToOwnedPlaylist` reads the current max `position` and inserts with `max + 1` in two separate queries. Two concurrent adds to the same playlist both read the same max and insert the same position, corrupting the ordering drag-and-drop relies on.

**Fix:** Compute the next position atomically — e.g. inside a transaction with `SELECT ... FOR UPDATE` on the playlist, or via a single `INSERT ... SELECT coalesce(max(position), -1) + 1 FROM playlist_items WHERE playlist_id = ...`.

---
## Verify a note belongs to the paper before deleting it
labels: type:bug, area:security, priority:p2

**File:** src/app/actions.ts:283

`deletePaperNoteAction` reads `paperId` from the form only to call `revalidatePath(/papers/{paperId})`, then calls `deletePaperNote(ownerId, noteId)`. The repository (`user-data.ts:1194`) filters only by `ownerId` and note `id`, never checking the note actually belongs to `paperId`. A crafted request could delete one of the user's notes on paper B while revalidating paper A (leaving B's page stale). Ownership is enforced, but the paper linkage is not validated.

**Fix:** Add `eq(paperNotes.paperId, paperId)` to the delete predicate (pass `paperId` through the repository function) so deletion is scoped to the intended paper.

---
## Order favorites and playlist reads deterministically
labels: type:bug, area:backend, priority:p3

**File:** src/lib/repositories/user-data.ts:974

The favorites query in `getLibraryPageData` selects paper IDs with no `ORDER BY`, so Postgres may return them in any order and the library's Favorites list can reshuffle between visits. Read later already orders by `addedAt`; favorites should be consistent too.

**Fix:** Add `.orderBy(desc(favorites.createdAt))` to the favorites query so the newest favorites appear first and ordering is stable.

---
## Give Read later items a real position instead of always 0
labels: type:bug, area:data-model, priority:p3

**File:** src/lib/repositories/user-data.ts:1252

`toggleReadLater` inserts every playlist item with `position: 0`, while `addToOwnedPlaylist` computes `max + 1`. All Read later items therefore share position 0, so any position-based ordering or future reorder of the default Read later playlist is meaningless. Today it's masked because the library orders Read later by `addedAt`.

**Fix:** Reuse the next-position computation from `addToOwnedPlaylist` in `toggleReadLater`, or drop `position` from the insert and rely on the column default consistently, and document the intended ordering.

---
## Preserve recommendation attribution for library and digest actions
labels: type:bug, area:analytics, priority:p3

**File:** src/app/actions.ts:137

`dismissPaperAction`, `toggleFavoriteAction`, and `toggleReadLaterAction` call the repository without the `options.recommendationImpressionId` that `/api/deck` always resolves. Saves/dismisses from the library and digest pages are therefore never linked to the recommendation impression that surfaced them, breaking downstream attribution for those surfaces.

**Fix:** Resolve and pass `recommendationImpressionId` in these actions (via a hidden form field plus `resolveRecommendationImpressionId`), or explicitly document that off-deck interactions are intentionally unattributed.

---
## Validate semantic match rows instead of an unchecked cast
labels: type:enhancement, area:recommendations, priority:p3

**File:** src/lib/repositories/semantic-retrieval.ts:69

`matchPapersByEmbedding` runs raw SQL and casts the result via `as unknown as SemanticMatchRow[]` with no runtime shape check. If the `match_papers_by_embedding` Postgres function's return columns change (rename/typo during a migration), the failure is silent: `semanticScores` maps undefined keys and `getPapersByIds` receives garbage IDs. The trailing `?? []` is also dead code since `db.execute` never returns null.

**Fix:** Add a small runtime guard (assert `typeof row.paper_id === "string"` and `typeof row.semantic_score === "number"`, filtering invalid rows) or a Zod schema before use, and remove the dead fallback.

---
## Validate triage summary JSON shape before casting
labels: type:enhancement, area:backend, priority:p3

**File:** src/lib/repositories/catalog.ts:64

`triageSummary` is read from a `jsonb` column and cast directly with `as Paper["triageSummary"]` with no validation. If the summariser writes a malformed object (missing a field, wrong type), consumers such as the paper detail page render `undefined` values or could throw, with no error surfaced.

**Fix:** Validate the four expected string fields at read time (small runtime check or Zod schema) and fall back to `undefined` when the shape is invalid.

---
## Rename the misleading requirePaperId helper used for playlist IDs
labels: type:refactor, area:backend, priority:p3

**File:** src/app/actions.ts:32

`requirePaperId` reads `formData.get("paperId")`, but `renamePlaylistAction` and `deletePlaylistAction` reuse it to extract a playlist ID that the sidebar submits in a hidden input also named `paperId`. The name collision makes the code confusing and easy to break during future edits.

**Fix:** Generalise the helper (e.g. `requireFormId(formData, field)`), rename the playlist hidden inputs to `playlistId`, and update the actions to read the correctly named field.

---
## Batch playlist item queries to remove the N+1 on the library page
labels: type:enhancement, area:performance, priority:p3

**File:** src/lib/repositories/user-data.ts:1002

`getLibraryPageData` maps over playlists and issues one `SELECT` per playlist to fetch its item IDs (inside `Promise.all`), producing N queries for N playlists on every library load, on top of the separate favorites/read-later reads.

**Fix:** Fetch all items in one query with `inArray(playlistItems.playlistId, playlistIds)` (ordered by playlist then position) and group by `playlistId` in memory.
