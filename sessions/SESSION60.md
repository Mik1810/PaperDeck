# Session 60

## Issue #121: playlist saving and Library editing UX

- Agreed that the bookmark control opens an owner-scoped multi-select picker on
  feed, digest, and paper detail. `Read later` stays first, a private playlist
  can be created inline, and swipe remains the quick direct `Read later` path.
- Added lazy playlist membership loading, optimistic add/remove updates with
  rollback, atomic playlist-and-paper creation, private no-store responses, and
  a single `save_to_playlist` ranking signal even when a paper belongs to
  multiple playlists.
- Kept feed impression attribution for new saves and refresh the profile
  embedding only after a real playlist addition.
- Made the desktop paper-detail card use the available content width.
- Made Library paper-card surfaces open the internal paper detail while keeping
  external links, drag handles, and mutation controls separate.
- Unified `Read later`, Favorites and Ignored as system collection rows above a
  divider, with custom playlists below under `My playlists`. `Read later` is the
  default Library selection and the content area renders only the active
  collection, eliminating the previous duplicated overview.
- Collection names navigate in normal view. Persistent pencils toggle a local
  edit state on and off without adding edit state to the URL; switching
  collection exits editing. `Read later` and custom playlists support
  reorder/removal, Favorites supports removal, and Ignored stays read-only.
- Custom playlist rename/delete actions remain in a separate options menu; all
  three system collections are protected from rename/delete.

## Safety and database scope

- All browser/database verification used a disposable local PostgreSQL container
  with synthetic users and catalog data. No shared Supabase data or remote
  account was read or modified.
- The standalone schema lacks the interaction uniqueness index present in the
  Drizzle model. The new transaction therefore serializes on the owner profile
  and checks for an existing save signal, so it remains correct with either
  schema state and does not duplicate ranking weight.

## Validation

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit` (106 passed)
- `TMPDIR=/tmp npm run audit:service-role`
- `TMPDIR=/tmp npm run build`
- Focused Playwright picker and Library flow: 4 passed across desktop and mobile
- Visual desktop/mobile verification: dialog remains inside the viewport,
  focus returns to its trigger, the desktop detail card occupies 95% of the
  main content width, playlist pencils and internal paper links are visible,
  and no browser console or Next.js overlay errors were observed.
- Agent-browser Library verification on desktop and 390x844 mobile: Read later
  loads by default, collection rows switch only the content panel, a second
  pencil click exits editing without changing the URL, custom edit navigation
  works from another collection, and no horizontal overflow or framework error
  overlay was detected.
- Agent-browser WCAG 2 A/AA audit initially found three labels at 4.44:1; after
  changing them from slate-500 to slate-600, the audit reported zero violations
  and a clean fresh-browser error log.

## Progressive Library loading

- Follow-up testing found that switching Library collections still triggered a
  dynamic App Router request, producing visible normal-view then edit-view
  transitions and multi-second waits against the development database.
- Split the Library read path: the initial server response contains Read later,
  collection metadata and counts; a private no-store endpoint preloads
  Favorites, Ignored and unique custom-playlist paper records after hydration.
- Normalized background paper data by ID and reuse one in-flight request, so a
  paper shared by multiple collections is not repeatedly transferred and an
  early user click waits on the existing preload rather than starting another.
- Collection selection and edit state now update atomically in one client render
  and use the native History API for shareable/back-forward URLs without an RSC
  navigation. Real mutations remain authenticated server actions.
- Extended Playwright coverage to prove the reported Read later editing to
  Favorites editing transition has no intermediate Favorites normal state and
  sends zero `/library?view=favorites` requests on desktop and mobile.
- Agent-browser measured the same mobile transition at 21.4 ms over two animation
  frames, with the final Favorites editing state and URL already synchronized;
  it captured no navigation request, no horizontal overflow, no framework error
  overlay and zero WCAG 2 A/AA violations.
