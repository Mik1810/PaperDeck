# Session 28 — Social-plan recommendation blockers

## Problem

The social-interactions plan kept #84 and #82 as open recommendation-core
gates. Settings interest toggles could race full-selection writes and leave the
UI ahead of persisted ranking inputs. Authenticated app links had also lost the
`prefetch={false}` behavior previously chosen after production tracing.

## Changes

- Replaced per-toggle interest autosave with an explicit `Save changes`
  mutation.
- Tracked the last confirmed selection, disabled interest toggles while saving,
  restored confirmed state after errors, and surfaced failures with
  `MutationAlert`.
- Added an E2E regression proving settings changes do not reach the database
  before Save and do persist afterward.
- Added `AppNavLink`, which disables Next.js prefetch by default, and used it
  for the authenticated header, desktop navigation, mobile settings, and bottom
  navigation links.
- Added a production trace check to the PWA release checklist.
- Updated the changelog and social-interactions gate status.

## Validation

- Focused settings-interest E2E (Chromium): 1 passed.
- `npm run typecheck` and `npm run lint`: passed.
- `npm run test:unit`: 48 passed.
- `npm run build`: passed.
