# PWA Cache Policy

The service worker caches static assets and `offline.html`. Authenticated HTML routes such as `/feed`, `/library`, `/settings`, `/onboarding`, and `/papers/*` must stay network-only so Cache Storage does not retain personalized pages.

## Response Policy

- Explicit public assets (`offline.html`, the manifest, icons, splash images, the service worker, and hashed Next.js assets) remain cacheable.
- Authentication entry points, personalized pages, RSC/data responses, APIs, mutations, and Clerk proxy/webhook responses use a private no-store policy.
- Personalized route responses declare `Cache-Control: private, no-store, max-age=0, must-revalidate`.
- `CDN-Cache-Control: no-store` and `Vercel-CDN-Cache-Control: no-store` prevent intermediary and Vercel CDN storage even when Next.js applies its development-only `no-cache, must-revalidate` override to the browser header.
- Unknown dynamic routes default to private no-store until they are deliberately classified as public static resources.

## Manual Release Checklist

- Install the app, sign in, open `/feed`, then confirm Cache Storage contains static assets and `/offline.html` but no `/feed` entry.
- In the browser Network panel, confirm authenticated HTML, RSC, and sensitive API responses include `private` and `no-store` in `Cache-Control`; confirm `CDN-Cache-Control` is `no-store`.
- On Preview and Production, confirm personalized responses are not served as a Vercel cache hit. `Vercel-CDN-Cache-Control` is consumed by Vercel and is not expected to reach the browser.
- Toggle offline mode while signed in and reload `/feed`; the app should show `offline.html`, not a stale feed.
- On a shared-device test browser, sign in as test user A, visit personalized surfaces, sign out, sign in as test user B, and confirm no DOM, back/forward entry, RSC response, API response, or Cache Storage entry exposes A's marker.
- Close and reopen the installed app after sign-out, then confirm protected routes redirect to sign-in when online.
- Ship a service worker update and reload twice; old `paperdeck-*` caches should be removed, leaving only the current static cache.
- In a production browser trace, idle on each authenticated surface and confirm visible app navigation does not prefetch other authenticated HTML/RSC routes before a deliberate tap.

## Clerk Development Shared-Device Smoke

Run the opt-in live smoke separately from normal App CI:

```bash
npm run test:e2e:clerk-cache
```

It requires the two configured Clerk Development test-user emails, Clerk Development keys, and server-only Supabase cleanup configuration. The test does not use or persist passwords. It snapshots pre-existing sessions, creates a random empty playlist only for test user A, verifies that B cannot recover A's marker through HTML, history, RSC, API responses, or Cache Storage, and deletes only the exact marker. The run fails if its new sessions or marker cannot be cleaned up.
