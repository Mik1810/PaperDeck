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

type QueryResultLike = { rowCount?: number | null; rows?: unknown[] };
type RunMetrics = {
  queryCount: number;
  rows: number;
  sqlMs: number;
  poolAcquireMs: number;
  poolAcquireCount: number;
  maxPoolOccupancy: number;
  maxPoolWaiting: number;
};

let activeMetrics: RunMetrics | null = null;
const poolPrototype = pg.Pool.prototype as unknown as {
  connect: (...args: unknown[]) => unknown;
  query: (...args: unknown[]) => unknown;
};
const originalConnect = poolPrototype.connect;
const originalQuery = poolPrototype.query;

poolPrototype.connect = function instrumentedPoolConnect(...args: unknown[]) {
  const metrics = activeMetrics;
  const startedAt = performance.now();
  const pool = this as pg.Pool;
  if (metrics) {
    metrics.maxPoolOccupancy = Math.max(
      metrics.maxPoolOccupancy,
      pool.totalCount - pool.idleCount,
    );
    metrics.maxPoolWaiting = Math.max(metrics.maxPoolWaiting, pool.waitingCount);
  }
  const record = () => {
    if (!metrics) return;
    metrics.poolAcquireCount += 1;
    metrics.poolAcquireMs += performance.now() - startedAt;
    metrics.maxPoolOccupancy = Math.max(
      metrics.maxPoolOccupancy,
      pool.totalCount - pool.idleCount,
    );
    metrics.maxPoolWaiting = Math.max(metrics.maxPoolWaiting, pool.waitingCount);
  };
  if (typeof args[0] === "function") {
    const callback = args[0] as (...callbackArgs: unknown[]) => void;
    return originalConnect.call(this, (...callbackArgs: unknown[]) => {
      record();
      callback(...callbackArgs);
    });
  }
  const result = originalConnect.apply(this, args) as Promise<unknown>;
  if (!result || typeof result.then !== "function") return result;
  return result.then((client) => {
    record();
    return client;
  });
};

poolPrototype.query = function instrumentedPoolQuery(...args: unknown[]) {
  const metrics = activeMetrics;
  const startedAt = performance.now();
  if (metrics) metrics.queryCount += 1;
  const result = originalQuery.apply(this, args) as
    | Promise<QueryResultLike>
    | QueryResultLike;
  if (!result || typeof (result as Promise<QueryResultLike>).then !== "function") {
    return result;
  }
  return (result as Promise<QueryResultLike>).then((queryResult) => {
    if (metrics) {
      metrics.sqlMs += performance.now() - startedAt;
      metrics.rows += Number(queryResult.rowCount ?? queryResult.rows?.length ?? 0);
    }
    return queryResult;
  });
};

const sql = postgres(databaseUrl, { max: 2, prepare: false });
const ownerId = `profile-input-benchmark-${randomUUID()}`;
const paperIds = Array.from({ length: 1_000 }, () => randomUUID());
const inputSizes = [10, 100, 1_000] as const;
const runs = 20;
const embedding = `[1,${Array.from({ length: 383 }, () => "0").join(",")}]`;

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

async function cleanup() {
  await sql`delete from profiles where owner_id = ${ownerId}`;
  await sql`delete from papers where id in ${sql(paperIds)}`;
}

async function seedCatalog() {
  await cleanup();
  await sql`
    insert into profiles (owner_id, display_name, embedding_input_generation)
    values (${ownerId}, 'Profile input benchmark', 1)
  `;
  await sql`
    insert into papers (
      id, title, abstract, source, url, access, embedding,
      embedding_model, embedding_dimension, embedded_at
    )
    select
      fixture.id::uuid,
      'Profile benchmark paper ' || fixture.position,
      'Disposable local profile-input benchmark fixture.',
      'manual',
      'https://example.invalid/profile-input-benchmark/' || fixture.position,
      'open',
      ${embedding}::vector,
      'sentence-transformers/all-MiniLM-L6-v2',
      384,
      '2026-08-18T00:00:00.000Z'::timestamptz
    from unnest(${paperIds}::text[]) with ordinality as fixture(id, position)
  `;
}

async function setInputSize(paperCount: number) {
  await sql`delete from favorites where owner_id = ${ownerId}`;
  await sql`
    insert into favorites (owner_id, paper_id, created_at)
    select
      ${ownerId},
      fixture.id::uuid,
      '2026-08-18T00:00:00.000Z'::timestamptz + fixture.position * interval '1 second'
    from unnest(${paperIds.slice(0, paperCount)}::text[])
      with ordinality as fixture(id, position)
  `;
  await sql`
    update profiles
    set embedding_input_generation = embedding_input_generation + 1
    where owner_id = ${ownerId}
  `;
}

async function measure(
  refreshUserProfileEmbedding: (ownerId: string) => Promise<unknown>,
) {
  const durations: number[] = [];
  const sqlDurations: number[] = [];
  const queryCounts: number[] = [];
  const rowCounts: number[] = [];
  const responseBytes: number[] = [];
  const poolAcquireDurations: number[] = [];
  const poolOccupancies: number[] = [];
  const poolWaiters: number[] = [];

  for (let index = 0; index < runs + 2; index += 1) {
    const metrics: RunMetrics = {
      queryCount: 0,
      rows: 0,
      sqlMs: 0,
      poolAcquireMs: 0,
      poolAcquireCount: 0,
      maxPoolOccupancy: 0,
      maxPoolWaiting: 0,
    };
    activeMetrics = metrics;
    const startedAt = performance.now();
    const result = await refreshUserProfileEmbedding(ownerId);
    const durationMs = performance.now() - startedAt;
    activeMetrics = null;
    if (index < 2) continue;
    durations.push(durationMs);
    sqlDurations.push(metrics.sqlMs);
    queryCounts.push(metrics.queryCount);
    rowCounts.push(metrics.rows);
    responseBytes.push(Buffer.byteLength(JSON.stringify(result)));
    poolAcquireDurations.push(
      metrics.poolAcquireCount
        ? metrics.poolAcquireMs / metrics.poolAcquireCount
        : 0,
    );
    poolOccupancies.push(metrics.maxPoolOccupancy);
    poolWaiters.push(metrics.maxPoolWaiting);
  }

  return {
    p50Ms: Number(percentile(durations, 0.5).toFixed(2)),
    p95Ms: Number(percentile(durations, 0.95).toFixed(2)),
    sqlP50Ms: Number(percentile(sqlDurations, 0.5).toFixed(2)),
    sqlP95Ms: Number(percentile(sqlDurations, 0.95).toFixed(2)),
    queriesP50: percentile(queryCounts, 0.5),
    rowsP50: percentile(rowCounts, 0.5),
    responseBytesP50: percentile(responseBytes, 0.5),
    poolAcquireP95Ms: Number(
      percentile(poolAcquireDurations, 0.95).toFixed(2),
    ),
    maxPoolOccupancy: Math.max(...poolOccupancies),
    maxPoolWaiting: Math.max(...poolWaiters),
    runs,
  };
}

async function main() {
  try {
    await seedCatalog();
    const { refreshUserProfileEmbedding } = await import(
      "../src/lib/repositories/user-profile-embeddings"
    );
    const scenarios = [];
    for (const paperCount of inputSizes) {
      await setInputSize(paperCount);
      const initial = await refreshUserProfileEmbedding(ownerId);
      if (initial.status !== "updated" || initial.vectorCount !== paperCount) {
        throw new Error(`Profile benchmark failed to seed ${paperCount} vectors`);
      }
      scenarios.push({
        savedPapers: paperCount,
        ...(await measure(refreshUserProfileEmbedding)),
      });
    }
    console.log(JSON.stringify({ scenarios }));
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
