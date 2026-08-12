import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { after, before, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import pg from "pg";
import postgres, { type Sql } from "postgres";
import {
  countExpiredRecommendationAnalytics,
  deleteExpiredImpressionBatch,
  pruneExpiredRecommendationAnalytics,
  type RecommendationAnalyticsBatch,
} from "../../scripts/lib/recommendation-analytics-retention";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
const enabled =
  process.env.PAPERDECK_RUN_RECOMMENDATION_RETENTION_INTEGRATION === "true";
const run = databaseUrl && enabled ? test : test.skip;
const ownerId = `recommendation-retention-${randomUUID()}`;
const paperId = randomUUID();
const cutoff = new Date("2026-08-01T00:00:00.000Z");
const expiredAt = new Date("2026-07-01T00:00:00.000Z");
const freshAt = new Date("2026-08-05T00:00:00.000Z");
let sql: Sql | undefined;
let locker: pg.Client | undefined;
let expiredImpressionIds: string[] = [];

async function cleanup() {
  assert.ok(sql);
  await sql`delete from profiles where owner_id = ${ownerId}`;
  await sql`delete from papers where id = ${paperId}::uuid`;
}

before(async () => {
  if (!databaseUrl || !enabled) return;
  sql = postgres(databaseUrl, { max: 2, prepare: false });
  locker = new pg.Client({ connectionString: databaseUrl });
  await locker.connect();
  await cleanup();
  await sql`
    insert into profiles (owner_id, display_name)
    values (${ownerId}, 'Recommendation retention fixture')
  `;
  await sql`
    insert into papers (id, title, abstract, year, source, url, access)
    values (
      ${paperId}::uuid,
      'Recommendation retention fixture paper',
      'Disposable local retention fixture.',
      2026,
      'manual',
      'https://example.invalid/recommendation-retention',
      'open'
    )
  `;

  const batchItems = Array.from({ length: 9 }, (_, index) => ({
    batch_id: randomUUID(),
    delivered_at: index < 8 ? expiredAt : freshAt,
    id: randomUUID(),
    model_version: "retention-integration",
    owner_id: ownerId,
    paper_id: paperId,
    rank: index + 1,
    score: 1,
  }));
  await sql`
    insert into recommendation_batch_items ${sql(
      batchItems,
      "id",
      "owner_id",
      "paper_id",
      "batch_id",
      "rank",
      "score",
      "model_version",
      "delivered_at",
    )}
  `;

  const impressions = batchItems.slice(0, 8).map((batchItem, index) => ({
    batch_id: batchItem.batch_id,
    batch_item_id: batchItem.id,
    id: randomUUID(),
    model_version: "retention-integration",
    owner_id: ownerId,
    paper_id: paperId,
    rank: batchItem.rank,
    score: 1,
    shown_at: index < 7 ? expiredAt : freshAt,
  }));
  expiredImpressionIds = impressions.slice(0, 7).map(({ id }) => id);
  await sql`
    insert into recommendation_impressions ${sql(
      impressions,
      "id",
      "owner_id",
      "paper_id",
      "batch_item_id",
      "batch_id",
      "rank",
      "score",
      "model_version",
      "shown_at",
    )}
  `;
  await sql`
    insert into user_paper_interactions (
      owner_id, paper_id, recommendation_impression_id, action, context
    ) values (
      ${ownerId},
      ${paperId}::uuid,
      ${expiredImpressionIds[0]}::uuid,
      'dismiss',
      'retention-integration'
    )
  `;
});

after(async () => {
  if (!sql) return;
  try {
    await locker?.query("rollback");
    await cleanup();
  } finally {
    await locker?.end();
    await sql.end();
  }
});

run("bounded pruning skips locks, commits batches, and preserves fresh rows", async () => {
  assert.ok(sql);
  assert.ok(locker);
  assert.deepEqual(await countExpiredRecommendationAnalytics(sql, cutoff), {
    batchItemCount: 7,
    impressionCount: 7,
  });

  await locker.query("begin");
  await locker.query(
    "select id from recommendation_impressions where id = $1::uuid for update",
    [expiredImpressionIds[0]],
  );
  const lockedProbeStartedAt = performance.now();
  assert.equal(await deleteExpiredImpressionBatch(sql, cutoff, 3), 3);
  const lockedProbeMs = performance.now() - lockedProbeStartedAt;
  assert.ok(lockedProbeMs < 1_000, `locked probe took ${lockedProbeMs}ms`);
  await locker.query("commit");

  const batches: RecommendationAnalyticsBatch[] = [];
  const result = await pruneExpiredRecommendationAnalytics({
    batchSize: 2,
    cutoff,
    maxBatches: 10,
    onBatch: (batch) => batches.push(batch),
    sql,
  });

  assert.equal(result.impressions.deletedCount, 4);
  assert.equal(result.impressions.batches, 2);
  assert.equal(result.batchItems.deletedCount, 7);
  assert.equal(result.batchItems.batches, 4);
  assert.equal(result.truncated, false);
  assert.ok(batches.every(({ deletedCount }) => deletedCount <= 2));
  assert.deepEqual(await countExpiredRecommendationAnalytics(sql, cutoff), {
    batchItemCount: 0,
    impressionCount: 0,
  });

  const [state] = await sql<{
    batch_items: number;
    impressions: number;
    linked_interactions: number;
  }[]>`
    select
      (select count(*)::integer from recommendation_batch_items where owner_id = ${ownerId}) as batch_items,
      (select count(*)::integer from recommendation_impressions where owner_id = ${ownerId}) as impressions,
      (
        select count(*)::integer
        from user_paper_interactions
        where owner_id = ${ownerId}
          and recommendation_impression_id is not null
      ) as linked_interactions
  `;
  assert.deepEqual(state, {
    batch_items: 2,
    impressions: 1,
    linked_interactions: 0,
  });
});

run("maximum batches truncate cleanly and report remaining work", async () => {
  assert.ok(sql);
  const batchItems = Array.from({ length: 3 }, (_, index) => ({
    batch_id: randomUUID(),
    delivered_at: expiredAt,
    id: randomUUID(),
    model_version: "retention-integration-limit",
    owner_id: ownerId,
    paper_id: paperId,
    rank: 100 + index,
    score: 1,
  }));
  await sql`
    insert into recommendation_batch_items ${sql(
      batchItems,
      "id",
      "owner_id",
      "paper_id",
      "batch_id",
      "rank",
      "score",
      "model_version",
      "delivered_at",
    )}
  `;
  await sql`
    insert into recommendation_impressions ${sql(
      batchItems.map((batchItem) => ({
        batch_id: batchItem.batch_id,
        batch_item_id: batchItem.id,
        id: randomUUID(),
        model_version: batchItem.model_version,
        owner_id: ownerId,
        paper_id: paperId,
        rank: batchItem.rank,
        score: 1,
        shown_at: expiredAt,
      })),
      "id",
      "owner_id",
      "paper_id",
      "batch_item_id",
      "batch_id",
      "rank",
      "score",
      "model_version",
      "shown_at",
    )}
  `;

  const result = await pruneExpiredRecommendationAnalytics({
    batchSize: 2,
    cutoff,
    maxBatches: 1,
    sql,
  });
  assert.equal(result.impressions.deletedCount, 2);
  assert.equal(result.batchItems.deletedCount, 2);
  assert.equal(result.impressions.statements, 1);
  assert.equal(result.batchItems.statements, 1);
  assert.equal(result.truncated, true);
  assert.deepEqual(await countExpiredRecommendationAnalytics(sql, cutoff), {
    batchItemCount: 1,
    impressionCount: 1,
  });
});
