# SESSION 12

Date: 2026-07-03
Task: Granular forced onboarding and readable CS topic labels

## What was done

- Added shared arXiv CS category label mapping so raw labels such as `cs.CV` render as readable topic names.
- Added topic taxonomy helpers for macro areas, categories, and microcategories.
- Reworked onboarding into a three-step macro/category/microcategory wizard with `Next`, `Back`, `Start PaperDeck`, and `Not now`.
- Reworked `/onboarding` again into a standalone dark full-screen guided wizard, outside the authenticated app shell and without clickable step navigation.
- Moved onboarding controls into a narrower separated right rail on desktop, keeping the preference grid as the dominant area.
- Ordered the macro step so the real `Theoretical CS` topic appears before the `Other CS` macro group.
- Removed onboarding preselection and the duplicate selected summary from the wizard; `Not now` still applies broad defaults server-side without showing them first.
- Changed `/` to redirect to `/onboarding` instead of `/feed`.
- Replaced the `/onboarding` loading fallback with the standalone dark wizard shell to avoid flashing the old `Topics` app shell.
- Added a `Not now` server action that marks onboarding complete with all broad non-micro interests selected.
- Added server-side onboarding gates for feed, library, settings, and paper detail pages.
- Updated settings to group interests by the same macro/category/microcategory structure.
- Prevented settings from deselecting the last active macro filter or the last saved topic.
- Cleared stale user profile embeddings when interests are emptied or skipped.
- Moved onboarding/settings profile embedding writes to a topic-only refresh-on-write path.
- Added wizard preload of the first 8 ranked feed papers into `recommendations` before redirecting to `/feed`.
- Added `/feed` consumption of fresh preloaded recommendation batches before falling back to live semantic ranking.
- Settings interest saves now clear the wizard preload batch so changed interests force a fresh feed ranking.
- Added a loading overlay for onboarding submit states: saving interests, building the preference vector, and ranking first papers.
- Added a recommendations index for owner/model/generated-at lookup.
- Applied `20260703170000_add_recommendations_initial_feed_index.sql` to the configured database and verified the index exists.
- Updated dev-auth app smoke tests to account for the forced onboarding gate.
- Made the dev-auth app smoke suite serial because it mutates the shared local dev profile.
- Updated `CHANGELOG.md` and `ROADMAP.md`.

## Validation

- `npm run lint` passed.
- `npx tsc --noEmit` passed.
- `npm run test:unit` passed with 22 tests.
- `npm run build` passed.
- `npm run test:e2e` passed with 6 tests passed and 2 skipped, using the Playwright-managed local dev server.
- Targeted Playwright mobile check on `http://localhost:3000/onboarding` and `/settings` passed at 390x844: macro/category/microcategory wizard advanced correctly, no horizontal overflow, and no raw `cs.*` labels were visible.
- Targeted Playwright mobile check on the standalone dark `/onboarding` wizard passed at 390x844: no horizontal overflow, `Categories` is no longer a clickable step button, and the flow advances through `Next`.
- `git diff --check` passed.
