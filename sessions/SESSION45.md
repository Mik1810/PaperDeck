# Session 45

## Authenticated cache and shared-device isolation

- Started issue #103 without coupling it to the deprecated Clerk `createRouteMatcher()` migration tracked separately in #105.
- Added `/digest` to the existing Clerk protected-route matcher.
- Added a fail-closed route cache classification for public static, authentication, personalized, mutation, webhook, and unknown dynamic responses.
- Applied private no-store browser, intermediary CDN, and Vercel CDN headers through both Next.js route headers and the proxy response path.
- Kept `offline.html`, the manifest, service worker, icons, splash images, and hashed Next.js assets explicitly cacheable.
- Added unit coverage for the route matrix and emitted header policy.
- Added Playwright coverage for HTML, RSC, mutation, public-asset, and Cache Storage behavior.
- Strengthened the PWA test so it visits `/feed` online and requests RSC data before proving neither response was cached.
- Documented authenticated caching controls and the Preview/Production shared-device release checklist.
- Deferred the live Clerk Development A/logout/B smoke until explicit approval is given for one temporary test-user playlist and the test-created sessions.
- After approval, added a separate Clerk Development Playwright configuration using the official testing helper, with screenshots, video, traces, password persistence, and default-CI execution disabled.
- Added a same-browser A/logout/B smoke that creates one randomly named empty playlist for test user A, checks DOM/history/RSC/API/Cache Storage isolation for user B, deletes the marker, and revokes every tracked temporary session.
- Hardened live-smoke cleanup by snapshotting pre-existing sessions and revoking every newly active A/B session created during the test window, including sessions whose browser helper times out before returning an ID.
- Made marker cleanup deterministic through an exact server-only match on test user A, the random playlist name, and `is_default = false`, avoiding a second browser login solely for deletion.
- Scoped the public auth-entry middleware bypass required by Clerk's local Playwright handshake to the dedicated smoke-test process; normal Development, Preview, and Production routing remains unchanged.
- Completed the live same-browser Clerk Development smoke successfully in 35.4 seconds; independent post-run audit confirmed zero recent test sessions and zero temporary playlists.
- Kept the live Clerk smoke outside default App CI under `npm run test:e2e:clerk-cache`.
