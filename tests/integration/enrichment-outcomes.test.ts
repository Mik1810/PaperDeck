import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import postgres, { type Sql } from "postgres";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
const enabled =
  process.env.PAPERDECK_RUN_ENRICHMENT_OUTCOMES_INTEGRATION === "true";
const run = databaseUrl && enabled ? test : test.skip;
const paperIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
let sql: Sql | undefined;

before(async () => {
  if (!databaseUrl || !enabled) return;
  sql = postgres(databaseUrl, { max: 2, prepare: false });

  for (const [index, id] of paperIds.entries()) {
    await sql`
      insert into papers (
        id,
        title,
        source,
        arxiv_id,
        doi,
        url,
        ingested_at
      ) values (
        ${id}::uuid,
        ${`Enrichment outcome fixture ${index}`},
        'arxiv',
        ${`outcome-${id}`},
        ${`10.0000/${id}`},
        ${`https://example.com/${id}`},
        ${new Date(Date.UTC(2026, 7, 20, 12, index)).toISOString()}
      )
    `;
  }
});

after(async () => {
  if (!sql) return;
  try {
    await sql`delete from papers where id in ${sql(paperIds)}`;
  } finally {
    await sql.end();
  }
});

run("outcome state advances bounded scans and enforces retry lifecycle", async () => {
  assert.ok(sql);
  const [security] = await sql<{
    anon_write: boolean;
    authenticated_read: boolean;
    rls: boolean;
    service_write: boolean;
  }[]>`
    select
      relrowsecurity as rls,
      has_table_privilege('anon', 'public.paper_enrichment_outcomes', 'insert') as anon_write,
      has_table_privilege('authenticated', 'public.paper_enrichment_outcomes', 'select') as authenticated_read,
      has_table_privilege('service_role', 'public.paper_enrichment_outcomes', 'insert') as service_write
    from pg_class
    where oid = 'public.paper_enrichment_outcomes'::regclass
  `;
  assert.deepEqual(security, {
    anon_write: false,
    authenticated_read: false,
    rls: true,
    service_write: true,
  });

  const indexes = await sql<{ indexname: string }[]>`
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'paper_enrichment_outcomes_paper_idx',
        'paper_enrichment_outcomes_retry_idx',
        'papers_semantic_scholar_enrichment_scan_idx',
        'papers_openalex_enrichment_scan_idx',
        'papers_unpaywall_enrichment_scan_idx'
      )
    order by indexname
  `;
  assert.equal(indexes.length, 5);

  await sql`
    insert into paper_enrichment_outcomes (
      provider,
      paper_id,
      outcome,
      attempt_count,
      last_checked_at,
      next_eligible_at
    ) values
      ('semantic_scholar', ${paperIds[0]}::uuid, 'not_found', 1, now(), null),
      ('semantic_scholar', ${paperIds[1]}::uuid, 'not_found', 1, now(), null),
      ('semantic_scholar', ${paperIds[2]}::uuid, 'retryable_error', 2, now() - interval '3 hours', now() - interval '1 hour')
  `;

  const eligible = await sql<{ id: string; attempt_count: number | null }[]>`
    select paper.id, outcome.attempt_count
    from papers as paper
    left join paper_enrichment_outcomes as outcome
      on outcome.paper_id = paper.id
     and outcome.provider = 'semantic_scholar'
    where paper.id in ${sql(paperIds)}
      and (
        outcome.paper_id is null
        or (
          outcome.outcome = 'retryable_error'
          and outcome.next_eligible_at <= now()
        )
      )
    order by paper.ingested_at desc, paper.id desc
  `;
  assert.deepEqual(
    new Set(eligible.map(({ id }) => id)),
    new Set([paperIds[2], paperIds[3]]),
  );

  await assert.rejects(
    sql`
      insert into paper_enrichment_outcomes (
        provider,
        paper_id,
        outcome,
        attempt_count,
        last_checked_at,
        next_eligible_at
      ) values (
        'openalex',
        ${paperIds[3]}::uuid,
        'not_found',
        1,
        now(),
        now() + interval '1 hour'
      )
    `,
    /paper_enrichment_outcomes_retry_check/,
  );

  await sql`delete from papers where id = ${paperIds[0]}::uuid`;
  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::integer as count
    from paper_enrichment_outcomes
    where paper_id = ${paperIds[0]}::uuid
  `;
  assert.equal(count, 0);
});

run("migration backfills every existing positive enrichment row", async () => {
  assert.ok(sql);
  const [gaps] = await sql<{
    openalex: number;
    semantic_scholar: number;
    unpaywall: number;
  }[]>`
    select
      (
        select count(*)::integer
        from papers as paper
        where paper.semantic_scholar_id is not null
          and not exists (
            select 1
            from paper_enrichment_outcomes as outcome
            where outcome.paper_id = paper.id
              and outcome.provider = 'semantic_scholar'
              and outcome.outcome = 'found'
          )
      ) as semantic_scholar,
      (
        select count(*)::integer
        from papers as paper
        where paper.openalex_id is not null
          and not exists (
            select 1
            from paper_enrichment_outcomes as outcome
            where outcome.paper_id = paper.id
              and outcome.provider = 'openalex'
              and outcome.outcome = 'found'
          )
      ) as openalex,
      (
        select count(*)::integer
        from paper_external_ids as external_id
        where external_id.provider = 'unpaywall_oa'
          and not exists (
            select 1
            from paper_enrichment_outcomes as outcome
            where outcome.paper_id = external_id.paper_id
              and outcome.provider = 'unpaywall'
              and outcome.outcome = 'found'
          )
      ) as unpaywall
  `;
  assert.deepEqual(gaps, {
    openalex: 0,
    semantic_scholar: 0,
    unpaywall: 0,
  });
});
