# Session 24 — Direct bug/perf fixes from ANALYSIS (issues #67–#79)

Worked through the "no-decision-needed" subset of the codebase-review issues.
Product-decision issues (#68, #74, #75) and the #78 refactor were left for a
follow-up after the user weighs in.

## #67 — Handle errors on swipe-right (Read later)

- `src/components/feed-deck.tsx`: the right-swipe path fired
  `submitDeckAction("read_later", ...)` fire-and-forget, so a failed save
  silently dropped the card (data loss).
- Added `handleReadLaterSubmit`, mirroring `handleDismissSubmit`: optimistic
  dismiss + `await` + rollback (`setPaperDismissed(id, false)`) and surfaced
  error via the existing `dismissError`/`dismissErrorMessage` card path.
- Routed the right swipe through it; updated `pointerUp` deps.

## #69 — Atomic `saveSelectedTopics`

- `src/lib/repositories/user-data.ts`: wrapped delete + insert + profile update
  in `db.transaction(...)` so onboarding interests can no longer be wiped by a
  crash between statements.

## #71 — Race in `addToOwnedPlaylist`

- `src/lib/repositories/playlist-items.ts`: moved into a transaction that locks
  the playlist row with `SELECT ... FOR UPDATE` before computing `max+1`,
  serializing concurrent adds. Ownership check now runs inside the same locked
  read.

## #70 — Atomic + batched playlist reorder

- Replaced the per-item `UPDATE` loop (N round trips, non-atomic) with a single
  `UPDATE ... SET position = CASE paper_id WHEN ...::uuid THEN idx ... END`
  statement scoped by `inArray`. Early-returns on empty input.

## #72 — Note deletion scoped to paper

- `deletePaperNote(ownerId, paperId, noteId)` now filters on `paperId` too;
  `deletePaperNoteAction` passes the form `paperId`. Prevents deleting a note on
  paper B while revalidating paper A.

## #73 — Deterministic favorites order

- `getLibraryPageData` favorites query now `.orderBy(desc(favorites.createdAt))`
  so the Favorites list is stable (newest first), matching Read later.

## #79 — Remove N+1 on library page

- `getLibraryPageData` now fetches all playlist items in one
  `inArray(playlistItems.playlistId, playlistIds)` query (ordered by playlist,
  position) and groups by `playlistId` in memory instead of one query per
  playlist.

## #76 / #77 — Already fixed in Session 23

- Verified both were resolved by the Zod adoption work (issue #65, uncommitted):
  - `semantic-retrieval.ts` uses `SemanticMatchRowArraySchema.parse(result)`
    (no unchecked cast, no dead `?? []`).
  - `catalog.ts` validates `triageSummary` via `TriageSummarySchema.parse(...)`.
- Left comments and closed both.

## Validation

- `tsc --noEmit`: clean.
- `eslint` on touched files: clean.
- `npm run test:unit`: 46/46 pass. (No unit tests cover the server-only
  repositories; changes are DB-behavioral.)

---

# Session 24 (cont.) — Product-decision issues (#68, #74, #75, #78)

After discussing the remaining product-decision issues with the user, agreed to
skip the analytics-tracking feature but fix genuine bugs/logic errors.

## #68 — Stop fabricating the current year (logic bug)

- `catalog.ts:54` returned `row.year ?? new Date().getFullYear()`: fabricated a
  fake year and made a read non-deterministic (changes each calendar year).
- `types/paper.ts`: `year: number` → `year?: number`.
- `catalog.ts`: `row.year ?? undefined`.
- `feed-ranking.ts:158`: `Math.max(0, (paper.year ?? 2020) - 2020)` so a missing
  year yields neutral recency (0), no `NaN`.
- UI: hide the year (and its `-` separator) when absent in `paper-card.tsx`,
  `sortable-playlist-paper.tsx`, `papers/[paperId]/page.tsx`,
  `paper-list-item.tsx`, `feed-deck.tsx`; `paper-metadata.tsx` shows `—`.

## #74 — Deterministic Read later ordering (Option 1)

- Discovery: the "Read later" default playlist is clickable in the sidebar and
  opens `PlaylistPapers` (ordered by `position` + drag reorder). Every Read
  later item has `position: 0`, so that view's order was non-deterministic.
- Decision: Read later is ordered by recency; positions are not meaningful for
  it. Fix without touching writes (and without reintroducing the #71 race):
  added `desc(playlistItems.addedAt)` as a tie-breaker to the grouped
  playlist-items query in `getLibraryPageData`, making ordering stable
  (newest-first) even when positions collide.

## #78 — Rename misleading `requirePaperId` helper

- `actions.ts`: added generic `requireFormId(formData, field)`; `requirePaperId`
  is now a thin wrapper. `renamePlaylistAction`/`deletePlaylistAction` read
  `requireFormId(formData, "playlistId")`.
- `playlist-sidebar.tsx`: renamed the two hidden inputs from `paperId` to
  `playlistId` (rename + delete forms).

## #75 — Closed as not needed

- Confirmed `context` and `recommendationImpressionId` on
  `user_paper_interactions` are only ever written, never read by app logic
  (ranking/feed read only `paperId`/`action`/`createdAt`). Pure analytics the
  user does not want → closed, no code change. (`dismissPaperAction`/
  `toggleFavoriteAction` are also unused dead paths; left as-is.)

## Validation (cont.)

- `tsc --noEmit`: clean.
- `eslint` on touched files: clean.
- `npm run test:unit`: 46/46 pass.

## Fix issue-import script writing `-` as the body

- Root cause: `scripts/create-issues.ts` invoked `gh issue create ... --body -`.
  `--body` takes a literal string, so every imported issue got the body `"-"`
  (this is why #67–#79 had empty `-` bodies); stdin was ignored.
- Fix: switched to `execFileSync("gh", [...])` with `--body-file -` (reads the
  body from piped stdin) and always pipe stdin (even in `--verbose`, which
  previously used `stdio: "inherit"` and would hang waiting on the TTY). Using
  an args array also removes fragile shell-quoting of the title.
- Verified end-to-end: imported a throwaway issue, confirmed a real multi-line
  Markdown body + label, then deleted it.


