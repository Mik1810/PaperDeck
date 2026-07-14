# PWA Cache Policy

The service worker caches static assets and `offline.html`. Authenticated HTML routes such as `/feed`, `/library`, `/settings`, `/onboarding`, and `/papers/*` must stay network-only so Cache Storage does not retain personalized pages.

## Manual Release Checklist

- Install the app, sign in, open `/feed`, then confirm Cache Storage contains static assets and `/offline.html` but no `/feed` entry.
- Toggle offline mode while signed in and reload `/feed`; the app should show `offline.html`, not a stale feed.
- Sign out, close and reopen the installed app, then confirm protected routes still redirect to sign-in when online.
- Ship a service worker update and reload twice; old `paperdeck-*` caches should be removed, leaving only the current static cache.
- In a production browser trace, idle on each authenticated surface and confirm visible app navigation does not prefetch other authenticated HTML/RSC routes before a deliberate tap.
