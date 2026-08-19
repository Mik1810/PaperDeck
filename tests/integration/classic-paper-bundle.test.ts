import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import postgres, { type Sql } from "postgres";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.PAPERDECK_RUN_CLASSIC_BUNDLE_INTEGRATION === "true";
const run = databaseUrl && enabled ? test : test.skip;
const semanticScholarId = `classic-bundle-${randomUUID()}`;
const concurrentSemanticScholarId = `classic-concurrent-${randomUUID()}`;
const arxivId = `classic.${randomUUID()}`;
const concurrentArxivId = `classic.${randomUUID()}`;
const topicIds = [randomUUID(), randomUUID()];
let sql: Sql | undefined;

function bundle(overrides: Record<string, unknown> = {}) {
  return {
    abstract: "Original classic abstract.",
    access: "open",
    arxiv_id: arxivId,
    authors: ["Original Author", "Second Author"],
    citation_count: 5000,
    doi: null,
    existing_paper_id: null,
    is_open_access: true,
    pdf_url: `https://arxiv.org/pdf/${arxivId}`,
    published_at: "2017-01-01T00:00:00.000Z",
    semantic_scholar_id: semanticScholarId,
    semantic_scholar_url: `https://www.semanticscholar.org/paper/${semanticScholarId}`,
    source: "arxiv",
    title: "Original classic title",
    title_fingerprint: "original classic title",
    topic_ids: topicIds,
    url: `https://arxiv.org/abs/${arxivId}`,
    venue: "ClassicConf",
    year: 2017,
    ...overrides,
  };
}

async function callBundle(payload: Record<string, unknown>) {
  assert.ok(sql);
  const rows = await sql<{ id: string }[]>`
    select public.upsert_classic_paper_bundle(
      ${sql.json(payload as postgres.JSONValue)}::jsonb
    ) as id
  `;
  return rows[0].id;
}

async function state(id = semanticScholarId) {
  assert.ok(sql);
  const [paper] = await sql<{
    author_names: string[];
    external_ids: string[];
    id: string;
    title: string;
    topic_ids: string[];
  }[]>`
    select
      paper.id,
      paper.title,
      coalesce(
        (select array_agg(author.name order by author.position) from paper_authors as author where author.paper_id = paper.id),
        '{}'::text[]
      ) as author_names,
      coalesce(
        (select array_agg(external.provider || ':' || external.external_id order by external.provider) from paper_external_ids as external where external.paper_id = paper.id),
        '{}'::text[]
      ) as external_ids,
      coalesce(
        (select array_agg(topic.topic_id::text order by topic.topic_id) from paper_topics as topic where topic.paper_id = paper.id and topic.source = 'classic_discovery'),
        '{}'::text[]
      ) as topic_ids
    from papers as paper
    where paper.semantic_scholar_id = ${id}
  `;
  return paper;
}

before(async () => {
  if (!databaseUrl || !enabled) return;
  sql = postgres(databaseUrl, { max: 8, prepare: false });
  await sql`
    insert into taxonomy_topics (id, slug, label, source, arxiv_category)
    values
      (${topicIds[0]}::uuid, ${`classic-${topicIds[0]}`}, 'Classic topic one', 'arxiv', 'cs.AI'),
      (${topicIds[1]}::uuid, ${`classic-${topicIds[1]}`}, 'Classic topic two', 'arxiv', 'cs.LG')
  `;
  await sql.unsafe(`
    create or replace function private.test_fail_classic_author_insert()
    returns trigger
    language plpgsql
    set search_path = ''
    as $$
    begin
      if new.name = 'Injected classic author failure' then
        raise exception 'injected_classic_author_insert_failure';
      end if;
      return new;
    end
    $$;

    create trigger test_fail_classic_author_insert
    before insert on public.paper_authors
    for each row execute function private.test_fail_classic_author_insert();
  `);
});

after(async () => {
  if (!sql) return;
  try {
    await sql.unsafe(`
      drop trigger if exists test_fail_classic_author_insert
      on public.paper_authors;
      drop function if exists private.test_fail_classic_author_insert();
    `);
    await sql`
      delete from papers
      where semantic_scholar_id in (${semanticScholarId}, ${concurrentSemanticScholarId})
    `;
    await sql`delete from taxonomy_topics where id in (${topicIds[0]}::uuid, ${topicIds[1]}::uuid)`;
  } finally {
    await sql.end();
  }
});

run("classic bundle rolls back after author deletion and retries idempotently", async () => {
  const firstPaperId = await callBundle(bundle());
  const originalState = await state();
  assert.deepEqual(originalState.author_names, ["Original Author", "Second Author"]);
  assert.deepEqual(originalState.topic_ids, [...topicIds].sort());

  await assert.rejects(
    callBundle(
      bundle({
        authors: ["Injected classic author failure"],
        title: "This classic update must roll back",
        topic_ids: [topicIds[1]],
      }),
    ),
  );
  assert.deepEqual(await state(), originalState);

  const retriedPaperId = await callBundle(bundle());
  assert.equal(retriedPaperId, firstPaperId);
  assert.deepEqual(await state(), originalState);
});

run("classic bundle persists one complete consistency set", async () => {
  const current = await state();
  const updatedId = await callBundle(
    bundle({
      authors: ["Updated Classic Author"],
      existing_paper_id: current.id,
      title: "Updated classic title",
      topic_ids: [topicIds[1]],
    }),
  );
  const updated = await state();

  assert.equal(updatedId, current.id);
  assert.equal(updated.title, "Updated classic title");
  assert.deepEqual(updated.author_names, ["Updated Classic Author"]);
  assert.deepEqual(updated.topic_ids, [...topicIds].sort());
  assert.deepEqual(updated.external_ids, [
    `arxiv:${arxivId}`,
    `semantic_scholar:${semanticScholarId}`,
  ]);
});

run("concurrent discovery of one classic resolves to one paper", async () => {
  const concurrentBundle = bundle({
    arxiv_id: concurrentArxivId,
    existing_paper_id: null,
    semantic_scholar_id: concurrentSemanticScholarId,
    semantic_scholar_url: `https://www.semanticscholar.org/paper/${concurrentSemanticScholarId}`,
    title: "Concurrent classic title",
    title_fingerprint: "concurrent classic title",
    url: `https://arxiv.org/abs/${concurrentArxivId}`,
  });
  const ids = await Promise.all(
    Array.from({ length: 6 }, () => callBundle(concurrentBundle)),
  );
  assert.equal(new Set(ids).size, 1);

  assert.ok(sql);
  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::integer as count
    from papers
    where semantic_scholar_id = ${concurrentSemanticScholarId}
       or arxiv_id = ${concurrentArxivId}
  `;
  assert.equal(count, 1);
});

run("classic bundle RPC is service-role-only", async () => {
  assert.ok(sql);
  const [permissions] = await sql<{
    anon_bundle: boolean;
    authenticated_bundle: boolean;
    service_bundle: boolean;
  }[]>`
    select
      has_function_privilege('anon', 'public.upsert_classic_paper_bundle(jsonb)', 'execute') as anon_bundle,
      has_function_privilege('authenticated', 'public.upsert_classic_paper_bundle(jsonb)', 'execute') as authenticated_bundle,
      has_function_privilege('service_role', 'public.upsert_classic_paper_bundle(jsonb)', 'execute') as service_bundle
  `;
  assert.deepEqual(permissions, {
    anon_bundle: false,
    authenticated_bundle: false,
    service_bundle: true,
  });
});
