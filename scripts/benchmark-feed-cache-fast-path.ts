import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { loadEnvConfig } from "@next/env";
import pg from "pg";
import postgres from "postgres";
import {
  assertDisposableLocalDatabase,
  DEFAULT_TEST_DATABASE_URL,
} from "./local-database";

loadEnvConfig(process.cwd());

const databaseUrl =
  process.env.PAPERDECK_TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
assertDisposableLocalDatabase(databaseUrl, "paperdeck_test");
process.env.DATABASE_URL = databaseUrl;
process.env.DATABASE_MAX_CONNECTIONS = "3";

type QueryMetrics = { queryCount: number; rows: number };
type QueryResultLike = { rowCount?: number | null; rows?: unknown[] };

let activeMetrics: QueryMetrics | null = null;
const poolPrototype = pg.Pool.prototype as unknown as {
  query: (...args: unknown[]) => unknown;
};
const originalPoolQuery = poolPrototype.query;

poolPrototype.query = function instrumentedPoolQuery(...args: unknown[]) {
  const metrics = activeMetrics;
  if (metrics) metrics.queryCount += 1;
  const result = originalPoolQuery.apply(this, args) as
    | Promise<QueryResultLike>
    | QueryResultLike;
  if (result && typeof (result as Promise<QueryResultLike>).then === "function") {
    return (result as Promise<QueryResultLike>).then((queryResult) => {
      if (metrics) {
        metrics.rows += Number(
          queryResult.rowCount ?? queryResult.rows?.length ?? 0,
        );
      }
      return queryResult;
    });
  }
  const immediateResult = result as QueryResultLike;
  if (metrics) {
    metrics.rows += Number(
      immediateResult.rowCount ?? immediateResult.rows?.length ?? 0,
    );
  }
  return immediateResult;
};

const sql = postgres(databaseUrl, { max: 2, prepare: false });
const ownerId = `feed-cache-benchmark-${randomUUID()}`;
const runs = 20;

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

async function cleanup() {
  await sql`delete from profiles where owner_id = ${ownerId}`;
}

async function seedOwner() {
  await cleanup();
  const [topic] = await sql<{ id: string }[]>`
    select id from taxonomy_topics order by sort_order, id limit 1
  `;
  if (!topic) throw new Error("Feed benchmark requires a taxonomy topic");
  await sql`
    insert into profiles (owner_id, onboarding_completed_at)
    values (${ownerId}, now())
  `;
  await sql`
    insert into user_interests (owner_id, topic_id)
    values (${ownerId}, ${topic.id}::uuid)
  `;
}

async function seedFreshBatch() {
  const paperRows = await sql<{ id: string }[]>`
    select id from papers order by id limit 50
  `;
  if (paperRows.length < 50) {
    throw new Error("Feed benchmark requires at least 50 papers");
  }
  const generatedAt = new Date().toISOString();
  await sql`
    insert into recommendations ${sql(
      paperRows.map((paper, index) => ({
        candidate_source: "catalog_fallback",
        generated_at: generatedAt,
        model_version: "paperdeck-initial-feed-v2",
        owner_id: ownerId,
        paper_id: paper.id,
        reason: "Cached benchmark recommendation",
        score: 50 - index,
      })),
      "owner_id",
      "paper_id",
      "score",
      "reason",
      "candidate_source",
      "model_version",
      "generated_at",
    )}
  `;
}

async function measureScenario(
  run: () => Promise<unknown>,
) {
  const durations: number[] = [];
  const queryCounts: number[] = [];
  const rowCounts: number[] = [];
  const responseBytes: number[] = [];

  for (let index = 0; index < runs + 2; index += 1) {
    const metrics = { queryCount: 0, rows: 0 };
    activeMetrics = metrics;
    const startedAt = performance.now();
    const result = await run();
    const duration = performance.now() - startedAt;
    activeMetrics = null;
    if (index < 2) continue;
    durations.push(duration);
    queryCounts.push(metrics.queryCount);
    rowCounts.push(metrics.rows);
    responseBytes.push(Buffer.byteLength(JSON.stringify(result)));
  }

  return {
    p50Ms: Number(percentile(durations, 0.5).toFixed(2)),
    p95Ms: Number(percentile(durations, 0.95).toFixed(2)),
    queriesP50: percentile(queryCounts, 0.5),
    responseBytesP50: percentile(responseBytes, 0.5),
    rowsP50: percentile(rowCounts, 0.5),
    runs,
  };
}

async function main() {
  try {
    await seedOwner();
    const { getRankedFeedPapers } = await import(
      "../src/lib/repositories/user-data"
    );
    const coldLiveRank = await measureScenario(() =>
      getRankedFeedPapers(ownerId),
    );
    await seedFreshBatch();
    const freshCacheHit = await measureScenario(() =>
      getRankedFeedPapers(ownerId),
    );
    if (freshCacheHit.queriesP50 >= coldLiveRank.queriesP50) {
      throw new Error("Fresh cache hits must execute fewer database queries");
    }
    if (freshCacheHit.rowsP50 >= coldLiveRank.rowsP50) {
      throw new Error("Fresh cache hits must transfer fewer database rows");
    }
    console.log(JSON.stringify({ coldLiveRank, freshCacheHit }));
  } finally {
    activeMetrics = null;
    try {
      await cleanup();
    } finally {
      await sql.end();
    }
  }
}

void main();
