# Session 100

## Issue #99: Production write activation

- Re-audited the shared PaperDeck Supabase project before rollout. Both #99
  migrations were recorded; RLS was enabled on the shared-paper and activity
  tables; add, remove, and preference RPCs remained executable only by
  `service_role`; and all group, membership, invitation, shared-paper,
  activity, and paper-notification counts were zero.
- Confirmed the latest `main` Vercel Production deployment was `READY`, the
  public `/groups` route returned HTTP 200 while signed out, and the preceding
  24-hour Production error-log query returned no error or fatal entries.
- After explicit approval, atomically changed only the singleton research-group
  runtime setting from `reads=true, writes=false` to
  `reads=true, writes=true`. The transaction required the exact prior state
  and exactly one updated row.
- Post-rollout verification confirmed both read and write gates active with all
  collaboration counts still zero. A fresh anonymous Production smoke returned
  HTTP 200 and the matching runtime window contained no error or fatal entry.
- The authenticated Production smoke created a group and added a shared paper;
  the user then removed the fixture group, returning all collaboration counts
  to zero. The supplied screenshots exposed a broken member avatar: stored
  profile images use `img.clerk.com`, but that host was absent from the Next.js
  remote-image allowlist. Added the exact HTTPS host to `remotePatterns` so the
  image optimizer can render Clerk avatars without broadening remote sources.
- Supabase advisors reported no new #99 security finding. Existing notices and
  the low-usage/index performance notices remain outside this rollout.

## Environment boundary

- The canonical disposable Docker database and local browser E2E paths were
  unavailable in this session because the Docker daemon was unavailable.
  Existing #99 integration and member/owner/mobile E2E evidence was not
  replaced with an ad-hoc database.
- The local browser suite remained unavailable, so the Clerk-avatar correction
  was covered by configuration review, typecheck, lint, and a successful
  Production build before the final repository gate.
