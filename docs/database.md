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

- `src/lib/supabase/server.ts` creates a service-role Supabase client for server-only code.
- `src/lib/auth/session.ts` converts the Clerk session into the PaperDeck `owner_id`.
- `src/lib/repositories/catalog.ts` seeds the initial mock catalog into Supabase and reads shared paper/topic data.
- `src/lib/repositories/user-data.ts` persists profiles, interests, favorites, default `Read later`, playlist items, Read later toggles, and user-paper interactions.
- `src/lib/ranking/feed-ranking.ts` computes the current MVP feed ranking from selected topics, recent user feedback, and seen-paper penalties.
- `src/app/actions.ts` exposes server actions for onboarding and paper interactions.

The service-role key remains server-only and must never be imported into client components.

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

### Worker Tables

- `ingestion_runs`
- `ingestion_cursors`

This tracks batch imports from arXiv, Semantic Scholar, OpenAlex, and later sources.

Current arXiv ingestion writes one `ingestion_runs` row per non-dry-run execution and stores `status`, `finished_at`, `imported_count`, and `error_message`.

`ingestion_cursors` stores source/category cursor state. Current arXiv cursor keys use the format `arxiv:<category>`, for example `arxiv:cs.CC`, and keep the newest `publishedAt` timestamp seen by a successful run.

## Embeddings

The initial embedding model is `BAAI/bge-small-en-v1.5`, which produces 384-dimensional vectors.

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

`topic_embeddings` stores offline topic vectors. `user_profile_embeddings` stores aggregate user vectors built from selected topics and interaction feedback.

`match_papers_by_embedding(query_embedding, match_count, embedding_model_filter)` performs pgvector top-K retrieval over `papers.embedding` and returns `paper_id` plus `semantic_score`. The feed repository uses it only when a stored user profile embedding exists.

## MVP Feed Ranking

The current live feed ranking is computed in `src/lib/ranking/feed-ranking.ts`, not persisted in `recommendations` yet.

Inputs:

- selected `user_interests`;
- hierarchy from `taxonomy_topics.parent_id`;
- recent `user_paper_interactions`;
- favorites and `Read later` state;
- paper metadata such as citation count, year, and classic flag.

Current behavior:

- exact topic matches rank highest;
- child/parent topic matches still count with lower weight;
- `open_detail`, `favorite`, `save_to_playlist`, and `read` add positive topic feedback;
- `dismiss` and `not_interested` add negative topic feedback;
- papers with `open_detail`, `dismiss`, `not_interested`, `read`, or `already_read` are hidden from the active deck.

`Already read` and `Not interested` are recorded from the paper detail page. Removing a paper from `Read later` deletes the playlist item but does not add negative feedback.

Embedding similarity will replace or augment this ranking once paper embeddings and user profile embeddings are generated.

Current integration already supports this path: if `user_profile_embeddings` has a vector for the user, `/feed` retrieves semantic candidates with pgvector, then applies the existing TypeScript reranker. Without a stored user vector, it falls back to the topic/feedback ranking.

## RLS Notes

`supabase/schema.sql` includes RLS policies written for a future Clerk JWT integration:

```sql
owner_id = auth.jwt() ->> 'sub'
```

These policies assume that Supabase receives a JWT where `sub` is the Clerk user ID. Until this is configured, direct client-side access to user-owned tables should not be used.

## MVP Rule

Use server-side access for user-specific data until Clerk JWT + Supabase RLS is fully configured and tested.

Do not expose `SUPABASE_SERVICE_ROLE_KEY` to browser code.
