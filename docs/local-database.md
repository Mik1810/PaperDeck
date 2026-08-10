# Local database and isolated tests

PaperDeck uses three deliberately separate database paths:

| Context | Database | Data |
| --- | --- | --- |
| Production and Preview | Supabase Transaction pooler (`6543`) | live catalog and live private data |
| Local development | Docker PostgreSQL 17 + pgvector 0.8.0 | remote catalog snapshot, no copied private data |
| App CI | PostgreSQL 17 + pgvector 0.8.0 service container | small deterministic synthetic fixture |

The standard Playwright suite is not a live Supabase test. It refuses to run
against anything except a loopback host with a database named
`paperdeck_test`. Clerk Development and Supavisor checks remain separate,
explicit integration commands.

## One-time local setup

Enable Docker Desktop's WSL integration for the distro that contains this
checkout. Then keep the remote Session-pooler URL in `DATABASE_ADMIN_URL` and
point the normal local runtime at Docker:

```dotenv
DATABASE_URL=postgresql://paperdeck:paperdeck_local_only@127.0.0.1:55432/paperdeck_test
PAPERDECK_LOCAL_DATABASE_URL=postgresql://paperdeck:paperdeck_local_only@127.0.0.1:55432/paperdeck_test
```

`DATABASE_ADMIN_URL` is read only by the catalog refresh command. Neither URL
is exposed to browser code.

## Refresh the catalog snapshot

```bash
npm run db:local:refresh
```

This command resets only `localhost/paperdeck_test`, then copies these public
catalog tables from `DATABASE_ADMIN_URL`:

- `taxonomy_topics`
- `topic_relations`
- `papers`
- `paper_authors`
- `paper_topics`
- `paper_external_ids`
- `topic_embeddings`

The temporary dump is deleted even if restore fails. Profiles, collaboration
identities and hashes, interests, interactions, playlists, groups,
notifications, and ingestion state are never selected. The final JSON report
contains counts only and asserts the local profile count is zero by inspection.

The local application can freely create synthetic private state after the
refresh. Refreshing again discards that local-only state; it never writes to
Supabase.

## Run tests

```bash
npm run test:e2e
```

The command starts the container when not running in CI, resets the disposable
database, loads `tests/fixtures/app-e2e.sql`, and starts Playwright. The fixture
contains synthetic topics, embeddings, papers, authors, and external IDs. Test
profiles and other private rows are created and deleted only inside this local
database.

CI uses the same engine and fixture without Supabase database or API secrets.
Use the explicitly named live integration scripts only when validating a real
Clerk Development or Supavisor boundary.
