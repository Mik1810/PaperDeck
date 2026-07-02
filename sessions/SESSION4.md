# Session 4

Date: 2026-07-02

## Goal

Reduce paper detail action latency without broad refactors, starting from the production HAR where a detail-page `POST /papers/[paperId]` took 1454ms.

## Starting Point

- Feed action latency was acceptable for MVP after the Session 3 fixes: production `POST /feed` samples were 539ms, 376ms, and 954ms.
- The remaining slow production interaction was a detail-page `POST /papers/708dece5-f0cd-4d4e-92d0-7ec9cb62ff3b`.
- HAR baseline for that detail action:

```text
Path: /papers/708dece5-f0cd-4d4e-92d0-7ec9cb62ff3b
Status: 303
Total: 1454ms
Wait: 1274ms
Receive: 179ms
Content-Type: text/x-component
x-action-redirect: /feed;push
x-vercel-id: cdg1 path
```

Interpretation: the Server Action redirect was returning an RSC payload and waiting on `/feed` rendering, not just recording the detail feedback mutation.

## Changes

- Replaced the detail `Already read` and `Not interested` Server Actions with a route-handler mutation:
  - new endpoint: `POST /papers/[paperId]/feedback`;
  - accepted actions: `already_read`, `not_interested`;
  - behavior: record `user_paper_interactions` with `context = detail`, then return a plain HTTP 303 to `/feed`.
- Moved the paper detail action cluster into `PaperDetailActions`, a client component.
  - Favorite and Read later now use the same immediate optimistic visual toggle pattern as the deck.
  - Already read and Not interested submit normal POST forms to the feedback route.
- Removed the unconditional `ensureUserProfileForOwner()` upsert from common mutation Server Actions.
  - Repository writes now retry after creating the profile only if Supabase reports a profile foreign-key miss.
  - This preserves first-run behavior while avoiding an extra profile upsert on the common path.
- Reduced paper detail state loading.
  - Detail rendering no longer calls the full feed-oriented `getUserPaperState()`.
  - It now checks favorite membership, Read later membership, and Read later count directly, without loading the recent 500 interactions.

## Verification

Static checks:

```text
npm run lint -> passed
npm run build -> passed
```

Focused local mutation timing for the new detail feedback insert path, using `.env.local`, `PAPERDECK_DEV_AUTH=true`, and `local-dev-user`:

```text
already_read:   600ms cold
not_interested: 148ms warm
already_read:    80ms warm
```

Local end-to-end route timing was not collected because a pre-existing Next dev server was already running on `localhost:3000` with Clerk auth enabled and redirected the feedback POST to sign-in. I did not kill or replace that user-owned process.

## Current Status

- Detail feedback no longer uses a Server Action/RSC redirect path.
- Detail favorite/read-later perceived latency is improved with optimistic UI.
- Feed latency remains acceptable for MVP.
- Recommended next verification after deployment: capture a production HAR and confirm `Already read`/`Not interested` POST to `/papers/[paperId]/feedback` returns a small 303 response, with `/feed` loading as the follow-up navigation rather than inside the mutation response.
