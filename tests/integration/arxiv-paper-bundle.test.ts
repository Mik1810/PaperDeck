import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import postgres, { type Sql } from "postgres";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.PAPERDECK_RUN_ARXIV_BUNDLE_INTEGRATION === "true";
const run = databaseUrl && enabled ? test : test.skip;
const arxivId = `bundle-${randomUUID()}`;
const cursorSuffix = randomUUID();
const publicationCursorKey = `test-arxiv:${cursorSuffix}`;
const revisionCursorKey = `test-arxiv-revisions:${cursorSuffix}`;
const topicIds = [randomUUID(), randomUUID()];
let sql: Sql | undefined;

function bundle(overrides: Record<string, unknown> = {}) {
  return {
    abstract: "Original abstract with $x$.",
    arxiv_id: arxivId,
    authors: ["Original Author", "Second Author"],
    doi: null,
    pdf_url: `https://arxiv.org/pdf/${arxivId}`,
    published_at: "2020-01-01T00:00:00.000Z",
    title: "Original title",
    topic_ids: topicIds,
    updated_at: "2020-01-02T00:00:00.000Z",
    url: `https://arxiv.org/abs/${arxivId}`,
    venue: "cs.AI",
    versioned_arxiv_id: `${arxivId}v1`,
    year: 2020,
    ...overrides,
  };
}

async function callBundle(payload: Record<string, unknown>) {
  assert.ok(sql);
  const rows = await sql<{ id: string }[]>`
    select public.upsert_arxiv_paper_bundle(${sql.json(payload as postgres.JSONValue)}::jsonb) as id
  `;
  return rows[0].id;
}

async function state() {
  assert.ok(sql);
  const [paper] = await sql<{
    abstract: string;
    author_names: string[];
    embedding_is_null: boolean;
    id: string;
    title: string;
    topic_ids: string[];
    triage_summary_is_null: boolean;
    updated_at: string;
    versioned_ids: string[];
  }[]>`
    select
      paper.id,
      paper.title,
      paper.abstract,
      paper.updated_at::text,
      paper.embedding is null as embedding_is_null,
      paper.triage_summary is null as triage_summary_is_null,
      coalesce(
        (select array_agg(author.name order by author.position) from paper_authors as author where author.paper_id = paper.id),
        '{}'::text[]
      ) as author_names,
      coalesce(
        (select array_agg(topic.topic_id::text order by topic.topic_id) from paper_topics as topic where topic.paper_id = paper.id and topic.source = 'arxiv_category'),
        '{}'::text[]
      ) as topic_ids,
      coalesce(
        (select array_agg(external.external_id order by external.external_id) from paper_external_ids as external where external.paper_id = paper.id and external.provider = 'arxiv'),
        '{}'::text[]
      ) as versioned_ids
    from papers as paper
    where paper.arxiv_id = ${arxivId}
  `;
  return paper;
}

before(async () => {
  if (!databaseUrl || !enabled) return;
  sql = postgres(databaseUrl, { max: 2, prepare: false });
  await sql`delete from papers where arxiv_id = ${arxivId}`;
  await sql`
    insert into taxonomy_topics (id, slug, label, source, arxiv_category)
    values
      (${topicIds[0]}::uuid, ${`bundle-${topicIds[0]}`}, 'Bundle topic one', 'arxiv', 'cs.AI'),
      (${topicIds[1]}::uuid, ${`bundle-${topicIds[1]}`}, 'Bundle topic two', 'arxiv', 'cs.LG')
  `;
  await sql.unsafe(`
    create or replace function private.test_fail_arxiv_author_insert()
    returns trigger
    language plpgsql
    set search_path = ''
    as $$
    begin
      if new.name = 'Injected author failure' then
        raise exception 'injected_author_insert_failure';
      end if;
      return new;
    end
    $$;

    create trigger test_fail_arxiv_author_insert
    before insert on public.paper_authors
    for each row execute function private.test_fail_arxiv_author_insert();
  `);
});

after(async () => {
  if (!sql) return;
  try {
    await sql.unsafe(`
      drop trigger if exists test_fail_arxiv_author_insert
      on public.paper_authors;
      drop function if exists private.test_fail_arxiv_author_insert();
    `);
    await sql`delete from papers where arxiv_id = ${arxivId}`;
    await sql`
      delete from ingestion_cursors
      where source = 'arxiv'
        and cursor_key in (${publicationCursorKey}, ${revisionCursorKey})
    `;
    await sql`delete from taxonomy_topics where id in (${topicIds[0]}::uuid, ${topicIds[1]}::uuid)`;
  } finally {
    await sql.end();
  }
});

run("bundle upsert rolls back after author deletion and retries idempotently", async () => {
  const firstPaperId = await callBundle(bundle());
  const originalState = await state();
  assert.deepEqual(originalState.author_names, ["Original Author", "Second Author"]);
  assert.deepEqual(originalState.topic_ids, [...topicIds].sort());

  await assert.rejects(
    callBundle(
      bundle({
        authors: ["Injected author failure"],
        title: "This must roll back",
        topic_ids: [topicIds[1]],
        updated_at: "2026-08-10T00:00:00.000Z",
        versioned_arxiv_id: `${arxivId}v2`,
      }),
    ),
  );
  assert.deepEqual(await state(), originalState);

  const retriedPaperId = await callBundle(bundle());
  assert.equal(retriedPaperId, firstPaperId);
  assert.deepEqual(await state(), originalState);
});

run("a revised old paper refreshes metadata and invalidates derived text", async () => {
  assert.ok(sql);
  const paperBefore = await state();
  await sql`
    update papers
    set
      embedding = array_fill(0.1::real, array[384])::vector,
      embedding_model = 'revision-fixture',
      embedding_dimension = 384,
      embedding_content_hash = 'stale',
      embedded_at = now(),
      triage_summary = '{"why_it_matters":"stale"}'::jsonb,
      triage_summary_model = 'revision-fixture',
      triage_summary_generated_at = now()
    where id = ${paperBefore.id}::uuid
  `;

  const revisedId = await callBundle(
    bundle({
      abstract: "Revised old abstract with $y$.",
      authors: ["Revised Author"],
      title: "Revised old title",
      topic_ids: [topicIds[1]],
      updated_at: "2026-08-11T00:00:00.000Z",
      versioned_arxiv_id: `${arxivId}v2`,
    }),
  );
  const revised = await state();
  assert.equal(revisedId, paperBefore.id);
  assert.equal(revised.title, "Revised old title");
  assert.equal(revised.abstract, "Revised old abstract with $y$.");
  assert.deepEqual(revised.author_names, ["Revised Author"]);
  assert.deepEqual(revised.topic_ids, [topicIds[1]]);
  assert.deepEqual(revised.versioned_ids, [`${arxivId}v1`, `${arxivId}v2`]);
  assert.equal(revised.embedding_is_null, true);
  assert.equal(revised.triage_summary_is_null, true);
  assert.match(revised.updated_at, /^2026-08-11 00:00:00\+00$/);
});

run("bundle and cursor RPCs are service-role-only", async () => {
  assert.ok(sql);
  const [permissions] = await sql<{
    anon_bundle: boolean;
    anon_cursor: boolean;
    authenticated_bundle: boolean;
    authenticated_cursor: boolean;
    service_bundle: boolean;
    service_cursor: boolean;
  }[]>`
    select
      has_function_privilege('anon', 'public.upsert_arxiv_paper_bundle(jsonb)', 'execute') as anon_bundle,
      has_function_privilege('authenticated', 'public.upsert_arxiv_paper_bundle(jsonb)', 'execute') as authenticated_bundle,
      has_function_privilege('service_role', 'public.upsert_arxiv_paper_bundle(jsonb)', 'execute') as service_bundle,
      has_function_privilege('anon', 'public.upsert_arxiv_ingestion_cursor(text,text,timestamptz,timestamptz,text,uuid,integer)', 'execute') as anon_cursor,
      has_function_privilege('authenticated', 'public.upsert_arxiv_ingestion_cursor(text,text,timestamptz,timestamptz,text,uuid,integer)', 'execute') as authenticated_cursor,
      has_function_privilege('service_role', 'public.upsert_arxiv_ingestion_cursor(text,text,timestamptz,timestamptz,text,uuid,integer)', 'execute') as service_cursor
  `;
  assert.deepEqual(permissions, {
    anon_bundle: false,
    anon_cursor: false,
    authenticated_bundle: false,
    authenticated_cursor: false,
    service_bundle: true,
    service_cursor: true,
  });
});

run("publication and revision cursors checkpoint independently", async () => {
  assert.ok(sql);
  await sql`
    select public.upsert_arxiv_ingestion_cursor(
      ${publicationCursorKey},
      'published',
      '2026-08-01T00:00:00Z'::timestamptz,
      null,
      '2608.00001',
      null,
      3
    )
  `;
  await sql`
    select public.upsert_arxiv_ingestion_cursor(
      ${revisionCursorKey},
      'revised',
      null,
      '2026-08-11T00:00:00Z'::timestamptz,
      '1999.00001',
      null,
      2
    )
  `;
  const rows = await sql<{
    cursor_key: string;
    last_seen_published_at: string | null;
    last_seen_updated_at: string | null;
  }[]>`
    select cursor_key, last_seen_published_at::text, last_seen_updated_at::text
    from ingestion_cursors
    where source = 'arxiv'
      and cursor_key in (${publicationCursorKey}, ${revisionCursorKey})
    order by cursor_key
  `;
  const publication = rows.find((row) => row.cursor_key === publicationCursorKey);
  const revision = rows.find((row) => row.cursor_key === revisionCursorKey);
  assert.match(publication?.last_seen_published_at ?? "", /^2026-08-01/);
  assert.equal(publication?.last_seen_updated_at, null);
  assert.equal(revision?.last_seen_published_at, null);
  assert.match(revision?.last_seen_updated_at ?? "", /^2026-08-11/);
});
