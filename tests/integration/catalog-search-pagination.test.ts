import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import postgres, { type Sql } from "postgres";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.PAPERDECK_RUN_CATALOG_SEARCH_INTEGRATION === "true";
const run = databaseUrl && enabled ? test : test.skip;
const paperIds = Array.from({ length: 45 }, () => randomUUID());
const topicId = randomUUID();
let sql: Sql | undefined;
let searchPapers: typeof import("../../src/lib/repositories/catalog")["searchPapers"];

async function cleanup() {
  assert.ok(sql);
  await sql`delete from taxonomy_topics where id = ${topicId}::uuid`;
  await sql`delete from papers where id in ${sql(paperIds)}`;
}

before(async () => {
  if (!databaseUrl || !enabled) return;
  sql = postgres(databaseUrl, { max: 4, prepare: false });
  ({ searchPapers } = await import("../../src/lib/repositories/catalog"));
  await cleanup();

  await sql`
    insert into taxonomy_topics (
      id, slug, label, source, depth, sort_order
    ) values (
      ${topicId}::uuid,
      ${`rare-geometry-${topicId}`},
      'Rare Geometry Topic 176',
      'catalog-search-fixture',
      0,
      176
    )
  `;

  const paperRows = paperIds.map((id, index) => ({
    abstract: `Synthetic cursor fixture abstract ${index}`,
    access: "open",
    arxiv_id: `2608.${(10_000 + index).toString()}`,
    doi: `10.176/cursor.${index.toString().padStart(3, "0")}`,
    id,
    source: "manual",
    title: `Cursor fixture catalog paper ${index.toString().padStart(2, "0")}`,
    url: `https://example.invalid/catalog-cursor/${index}`,
    year: index % 11 === 0 ? null : 2026 - (index % 4),
  }));
  await sql`
    insert into papers ${sql(
      paperRows,
      "id",
      "title",
      "abstract",
      "year",
      "source",
      "arxiv_id",
      "doi",
      "url",
      "access",
    )}
  `;
  const authorRows = paperIds.map((paperId, index) => ({
    name:
      index === 7
        ? "Distinctive Search Author 176"
        : `Cursor Fixture Author ${index}`,
    paper_id: paperId,
    position: 0,
  }));
  await sql`
    insert into paper_authors ${sql(
      authorRows,
      "paper_id",
      "name",
      "position",
    )}
  `;
  await sql`
    insert into paper_topics (paper_id, topic_id, confidence, source)
    values (
      ${paperIds[13]}::uuid,
      ${topicId}::uuid,
      1,
      'catalog-search-fixture'
    )
  `;
});

after(async () => {
  if (!sql) return;
  try {
    await cleanup();
  } finally {
    await sql.end();
  }
});

run("walks forward and backward without OFFSET, gaps, or duplicates", async () => {
  const first = await searchPapers("Cursor fixture catalog");
  assert.equal(first.page, 1);
  assert.equal(first.results.length, 20);
  assert.equal(first.previousCursor, null);
  assert.ok(first.nextCursor);

  const second = await searchPapers(
    "Cursor fixture catalog",
    first.nextCursor,
  );
  assert.equal(second.page, 2);
  assert.equal(second.results.length, 20);
  assert.ok(second.previousCursor);
  assert.ok(second.nextCursor);

  const third = await searchPapers(
    "Cursor fixture catalog",
    second.nextCursor,
  );
  assert.equal(third.page, 3);
  assert.equal(third.results.length, 5);
  assert.ok(third.previousCursor);
  assert.equal(third.nextCursor, null);

  const combinedIds = [...first.results, ...second.results, ...third.results]
    .map((paper) => paper.id);
  assert.equal(combinedIds.length, 45);
  assert.equal(new Set(combinedIds).size, 45);

  const previousSecond = await searchPapers(
    "Cursor fixture catalog",
    third.previousCursor,
  );
  assert.deepEqual(
    previousSecond.results.map((paper) => paper.id),
    second.results.map((paper) => paper.id),
  );
});

run("finds author, arXiv, DOI, and topic-label matches", async () => {
  for (const [query, expectedPaperId] of [
    ["Distinctive Search Author 176", paperIds[7]],
    ["2608.10009", paperIds[9]],
    ["10.176/cursor.011", paperIds[11]],
    ["Rare Geometry Topic 176", paperIds[13]],
  ] as const) {
    const result = await searchPapers(query);
    assert.equal(result.results[0]?.id, expectedPaperId, query);
  }
});
