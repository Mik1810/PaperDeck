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

Future hardening:

1. Configure Clerk JWT templates for Supabase.
2. Make `auth.jwt() ->> 'sub'` equal the Clerk user ID.
3. Enforce RLS directly in Supabase for browser/client access where appropriate.

## Schema Files

- `supabase/schema.sql`: initial schema, indexes, pgvector setup, and future RLS policies.

## Core Tables

### User-Owned Tables

- `profiles`
- `user_interests`
- `playlists`
- `playlist_items`
- `favorites`
- `user_paper_interactions`
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

These are shared paper and topic catalog data. Authenticated users can read them once Clerk JWT integration is active.

### Worker Tables

- `ingestion_runs`

This tracks batch imports from arXiv, Semantic Scholar, OpenAlex, and later sources.

## Embeddings

The initial embedding model is `BAAI/bge-small-en-v1.5`, which produces 384-dimensional vectors.

`papers.embedding` is defined as:

```sql
embedding vector(384)
```

Each embedded paper also stores:

- `embedding_model`
- `embedding_dimension`
- `embedded_at`

This keeps future model migrations traceable.

## RLS Notes

`supabase/schema.sql` includes RLS policies written for a future Clerk JWT integration:

```sql
owner_id = auth.jwt() ->> 'sub'
```

These policies assume that Supabase receives a JWT where `sub` is the Clerk user ID. Until this is configured, direct client-side access to user-owned tables should not be used.

## MVP Rule

Use server-side access for user-specific data until Clerk JWT + Supabase RLS is fully configured and tested.

Do not expose `SUPABASE_SERVICE_ROLE_KEY` to browser code.
