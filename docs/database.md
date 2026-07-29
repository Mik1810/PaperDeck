# Database Plan

PaperDeck uses Supabase Postgres with pgvector. Clerk is the authentication provider.

## MVP Auth Model

For the MVP, user-owned records store the Clerk user ID in an `owner_id text` column.

Examples:

- `profiles.owner_id`
- `favorites.owner_id`
- `playlists.owner_id`
- `user_interests.owner_id`
- `user_paper_interactions.owner_id`

This does not replace RLS. It gives each row an owner so server routes/actions can enforce access with Clerk's `auth().userId`.

## Access Strategy

Initial implementation:

1. Clerk authenticates users.
2. Next.js server routes/actions read the Clerk user ID.
3. Server-side Supabase clients write `owner_id = auth().userId`.
4. Client components do not receive Supabase service keys.
5. User-specific reads/writes go through server-controlled code.

Current implementation:

- `src/db/schema.ts` + `src/db/index.ts` provides the Drizzle ORM client for all app-level database queries.
- `src/lib/supabase/server.ts` retains `createServiceRoleClient()` for ingestion/enrichment scripts and `createClerkAuthenticatedClient()` for RLS verification.
- `src/lib/auth/session.ts` converts the Clerk session into the PaperDeck `owner_id`.
- `src/lib/repositories/catalog.ts` reads shared paper/topic data via Drizzle (no seed writes during user requests).
- `src/lib/repositories/user-data.ts` persists profiles, interests, favorites, default `Read later`, playlist items, Read later toggles, and user-paper interactions via Drizzle.
- `src/lib/ranking/feed-ranking.ts` computes the current MVP feed ranking from selected topics, recent user feedback, and seen-paper penalties.
- `src/app/actions.ts` exposes server actions for onboarding and paper interactions.
- `research_groups` and `research_group_members` form a separate private
  collaboration domain. Their repository uses one centralized owner/admin/member
  permission evaluator before returning data or mutating rows.

The service-role key remains server-only and must never be imported into client components.

Service-role audit:

- `npm run audit:service-role` checks that `SUPABASE_SERVICE_ROLE_KEY` is referenced only by `src/lib/supabase/server.ts` under `src/`.
- The same audit requires `import "server-only"` in `src/lib/supabase/server.ts`, `src/lib/auth/session.ts`, and every file under `src/lib/repositories/`.
- It also walks runtime imports from `"use client"` files and fails if a client component reaches `server-only` code, while treating `"use server"` action files as a valid boundary.
- Current audit result on 2026-07-02: passed.

Future hardening:

1. Configure Clerk JWT templates for Supabase.
2. Make `auth.jwt() ->> 'sub'` equal the Clerk user ID.
3. Enforce RLS directly in Supabase for browser/client access where appropriate.

## Schema Files

- `supabase/schema.sql`: initial schema, indexes, pgvector setup, and future RLS policies.

## Applied Schema

The initial schema was applied to the PaperDeck Supabase project on 2026-07-01.

Validation after the latest embedding schema migration:

- 19 public tables exist.
- `pgcrypto` and `vector` extensions are enabled.
- RLS is enabled on all public tables created by the schema.
- 19 policies are present.

Note: Supabase/Postgres warns that creating the `ivfflat` index on an empty `papers` table can have low recall until data is loaded. This is expected during setup.

## Core Tables

### User-Owned Tables

- `profiles`
- `user_interests`
- `playlists`
- `playlist_items`
- `favorites`
- `user_paper_interactions`
- `user_profile_embeddings`
- `recommendations`
- `digests`
- `digest_items`
- `paper_notes`

These tables contain or derive ownership from `owner_id`.

### Shared Catalog Tables

- `papers`
- `paper_authors`
- `paper_topics`
- `paper_external_ids`
- `taxonomy_topics`
- `topic_relations`
- `topic_embeddings`

These are shared paper and topic catalog data. Authenticated users can read them once Clerk JWT integration is active.

### Private Research-Group Tables

- `research_groups`
- `research_group_members`

Membership is the single ownership source: each group must have exactly one
active `owner`. A selected successor must be an active non-owner member.
Authenticated Data API clients receive group rows only through RLS and can read
only their own raw membership row; they have no direct write grants. Server-side
member lists project public collaboration UUID, display name, image, role, and
join date without returning Clerk IDs, emails, or HMAC values.

`private.research_group_runtime_settings` holds independent read and write
switches, both disabled by default. The private schema is not exposed through
the Data API. `handle_research_group_account_closure(owner_id)` is executable
only by `service_role` and transfers ownership to the selected active successor,
otherwise the oldest active admin, then oldest active member, with `member_id`
as a deterministic tie-break. A group is deleted only if nobody can succeed.

The #107 migration adds `handle_clerk_user_deleted(owner_id)`, also executable
only by `service_role`. One RPC invocation calls the group lifecycle routine and
then deletes the matching `collaboration_identities` row in the same PostgreSQL
transaction. A failure in either phase rolls back both; repeated or concurrent
delivery performs the lifecycle work at most once and returns zero counts after
completion. The function does not delete the Clerk user, profile, private
playlists, notes, ranking signals, sessions, or tokens.

The foundation is versioned in
`supabase/migrations/20260729105307_add_private_research_groups.sql`, followed
by the RLS optimization migration. Both were validated against an isolated
PostgreSQL 17 cluster and applied during Development validation to the shared
PaperDeck Supabase project with read/write switches disabled. This project is
also used by Vercel Production; there is no separate Production database. The
#107 lifecycle wrapper is applied there: the locally signed synthetic webhook
gate passed, exact fixture cleanup was verified, both switches remain disabled,
and only `service_role` can execute the wrapper. The Production application
remains unchanged until its separately approved deployment.

Development verification includes the nine-case synthetic PostgreSQL suite, a
real Clerk A/B JWT smoke, and the synthetic account-deletion webhook gate. The
live tests temporarily exercise owner, outsider, member, revoked, succession,
owner-only deletion, unrelated membership removal, and duplicate-delivery
behavior, then verify zero temporary rows and restore both runtime switches to
disabled.

### Worker Tables

- `ingestion_runs`
- `ingestion_cursors`

This tracks batch imports from arXiv, Semantic Scholar, OpenAlex, and later sources.

Current arXiv ingestion writes one `ingestion_runs` row per non-dry-run execution and stores `status`, `finished_at`, `imported_count`, and `error_message`.

`ingestion_cursors` stores source/category cursor state. Current arXiv cursor keys use the format `arxiv:<category>`, for example `arxiv:cs.CC`, and keep the newest `publishedAt` timestamp seen by a successful run.

## Embeddings

The current embedding model is `sentence-transformers/all-MiniLM-L6-v2`, which produces 384-dimensional vectors.

The full batch workflow is specified in [`docs/embeddings.md`](./embeddings.md).

`papers.embedding` is defined as:

```sql
embedding vector(384)
```

Each embedded paper also stores:

- `embedding_model`
- `embedding_dimension`
- `embedding_content_hash`
- `embedded_at`

The schema now includes `papers.embedding_content_hash`, `topic_embeddings`, and `user_profile_embeddings` as described in the embedding workflow. This keeps future model migrations and stale-vector detection traceable.

`topic_embeddings` stores offline topic vectors generated by `scripts/embed_topics.py`. An early BGE-small smoke run wrote 2 topic vectors and 1 paper vector, all with 384 dimensions; those rows are historical baseline data. Current worker runs write MiniLM rows, and rows with a different `embedding_model` are treated as stale for the active model. `user_profile_embeddings` stores aggregate user vectors built from selected topics and interaction feedback.

Remote verification on 2026-07-03 found 571 embedded paper rows for MiniLM, 66 MiniLM topic rows plus 66 historical BGE-small topic rows, and 2 MiniLM user profile rows plus 2 historical BGE-small profile rows.

`match_papers_by_embedding(query_embedding, match_count, embedding_model_filter)` performs pgvector top-K retrieval over `papers.embedding` and returns `paper_id` plus `semantic_score`. Its 100-list IVFFlat index is queried with ten probes so the RPC can satisfy the requested candidate count with useful recall. The feed repository uses it only when a stored user profile embedding exists.

`src/lib/repositories/user-profile-embeddings.ts` writes `user_profile_embeddings` from stored topic vectors during onboarding/settings updates. It does not call an embedding model; it only aggregates vectors that already exist in Supabase and clears stale stored profiles when no source vectors are available. The older interaction-aware refresh path remains available for future background refresh work.

## MVP Feed Ranking

The current live feed ranking is computed in `src/lib/ranking/feed-ranking.ts`. The first post-wizard deck is persisted in `recommendations` as a short-lived preload batch, and live feed rankings are also cached briefly there so `/feed` can avoid rerunning semantic retrieval and reranking on every refresh.

Inputs:

- selected `user_interests`;
- hierarchy from `taxonomy_topics.parent_id`;
- recent `user_paper_interactions`;
- favorites and `Read later` state;
- paper metadata such as citation count, year, and classic flag.

Current behavior:

- exact topic matches rank highest;
- child/parent topic matches still count with lower weight;
- `open_detail`, `favorite`, `save_to_playlist`, `read`, and `already_read` add positive topic feedback;
- `dismiss` and `not_interested` add negative topic feedback;
- papers with `open_detail`, `dismiss`, `favorite`, `save_to_playlist`, `not_interested`, `read`, or `already_read` are hidden from the active deck;
- current favorites and `Read later` items are also authoritative hidden state, so pruning or resetting interaction history cannot make them reappear.

`Already read` and `Not interested` are recorded from the paper detail page. `already_read` has the same positive weight as the legacy `read` signal. Removing a paper from `Read later` deletes the playlist item but does not add negative feedback.

Embedding similarity will replace or augment this ranking once paper embeddings and user profile embeddings are generated.

Current integration already supports this path: onboarding/settings writes create the stored user vector from selected topic embeddings. `/feed` first tries a fresh `recommendations` preload batch from the wizard, then a fresh live `recommendations` batch. Cached batches below the ten-visible-paper floor are regenerated. Without a usable batch, if `user_profile_embeddings` has a vector for the user, `/feed` retrieves semantic candidates with pgvector and applies the existing TypeScript reranker. When fewer than 50 unseen semantic candidates remain, the same reranker fills the deck from the full catalog while retaining semantic scores and recording per-paper candidate provenance. Without a stored user vector, it uses the topic/feedback catalog ranking.

New recommendation rows persist that provenance in nullable
`recommendations.candidate_source`, constrained to `semantic` or
`catalog_fallback`. Historical rows remain `NULL` and retain their broader
`initial_batch` or `live_batch` source label when reconstructed.

## RLS Notes

`supabase/schema.sql` includes RLS policies written for a future Clerk JWT integration:

```sql
owner_id = auth.jwt() ->> 'sub'
```

These policies assume that Supabase receives a JWT where `sub` is the Clerk user ID. Until this is configured, direct client-side access to user-owned tables should not be used.

## MVP Rule

Use server-side access for user-specific data until Clerk JWT + Supabase RLS is fully configured and tested.

Do not expose `SUPABASE_SERVICE_ROLE_KEY` to browser code.

## Collaboration identity and friendships

The collaboration domain is separate from private playlists and ranking data:

- `collaboration_identities` maps an immutable public UUID to an owner and a
  server-HMAC email lookup digest; it never stores the lookup email.
- `friend_requests` stores pending, accepted, declined, and cancelled lifecycle
  rows. A partial unique index permits only one pending request per unordered
  user pair.
- `friendships` stores one canonical reciprocal pair after acceptance.
- `user_blocks` stores directional blocks; a block cancels pending requests,
  removes friendship, and suppresses discovery in both directions.

Authenticated clients can read only rows in which they participate (and only
their own outgoing blocks). Writes go through security-definer RPCs that derive
the actor from `auth.jwt() ->> 'sub'`, serialize each pair with a transaction
advisory lock, enforce a 30-day decline cooldown and 10-new-request daily limit,
and expose only public collaboration profile fields. These operations do not
touch `user_paper_interactions`, recommendations, or profile embeddings.
