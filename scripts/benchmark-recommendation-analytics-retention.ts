import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { loadEnvConfig } from "@next/env";
import postgres, { type Sql } from "postgres";
import {
  pruneExpiredRecommendationAnalytics,
  type RecommendationAnalyticsBatch,
} from "./lib/recommendation-analytics-retention";
import { assertDisposableLocalDatabase } from "./local-database";

loadEnvConfig(process.cwd());

const DEFAULT_DATABASE_URL =
  "postgresql://paperdeck:paperdeck_local_only@127.0.0.1:55432/paperdeck_test";
const databaseUrl =
  process.env.PAPERDECK_TEST_DATABASE_URL ?? DEFAULT_DATABASE_URL;
assertDisposableLocalDatabase(databaseUrl, "paperdeck_test");

const cutoff = new Date("2026-08-01T00:00:00.000Z");
const expiredAt = new Date("2026-07-01T00:00:00.000Z");
const freshAt = new Date("2026-08-05T00:00:00.000Z");
const batchSize = 10_000;
const supportedScales = [10_000, 100_000, 1_000_000];
const scaleArg = process.argv.find((argument) => argument.startsWith("--scale="));
const requestedScale = Number(scaleArg?.split("=")[1]);
if (scaleArg && !supportedScales.includes(requestedScale)) {
  throw new Error(
    `Benchmark scale must be one of: ${supportedScales.join(", ")}.`,
  );
}
const scales = scaleArg ? [requestedScale] : supportedScales;
const monitorIntervalMs = 25;

type PlanNode = {
  "Actual Rows"?: number;
  "Index Name"?: string;
  "Node Type": string;
  Plans?: PlanNode[];
};

type ExplainDocument = {
  "Execution Time": number;
  Plan: PlanNode;
};

type TableHealth = {
  deadTuples: number;
  liveTuples: number;
  totalBytes: number;
};

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function compactPlan(node: PlanNode): Array<Record<string, unknown>> {
  return [
    {
      actualRows: node["Actual Rows"],
      indexName: node["Index Name"],
      nodeType: node["Node Type"],
    },
    ...(node.Plans?.flatMap(compactPlan) ?? []),
  ];
}

async function tableHealth(sql: Sql): Promise<{
  batchItems: TableHealth;
  impressions: TableHealth;
}> {
  const rows = await sql<{
    n_dead_tup: string;
    n_live_tup: string;
    relname: "recommendation_batch_items" | "recommendation_impressions";
    total_bytes: string;
  }[]>`
    select
      stats.relname,
      stats.n_live_tup::text,
      stats.n_dead_tup::text,
      pg_total_relation_size(stats.relid)::text as total_bytes
    from pg_stat_user_tables as stats
    where stats.relname in (
      'recommendation_batch_items',
      'recommendation_impressions'
    )
    order by stats.relname
  `;
  const byName = new Map(rows.map((row) => [row.relname, row]));
  const project = (name: typeof rows[number]["relname"]): TableHealth => {
    const row = byName.get(name);
    return {
      deadTuples: Number(row?.n_dead_tup ?? 0),
      liveTuples: Number(row?.n_live_tup ?? 0),
      totalBytes: Number(row?.total_bytes ?? 0),
    };
  };
  return {
    batchItems: project("recommendation_batch_items"),
    impressions: project("recommendation_impressions"),
  };
}

async function explainIndexCandidate(sql: Sql) {
  const rows = await sql<{ "QUERY PLAN": ExplainDocument[] }[]>`
    explain (analyze, buffers, format json)
    select id
    from private.recommendation_impression_index_benchmark
    where shown_at < ${cutoff.toISOString()}
    order by shown_at, id
    limit ${batchSize}
  `;
  const document = rows[0]?.["QUERY PLAN"]?.[0];
  if (!document) throw new Error("Missing recommendation retention query plan.");
  return {
    executionMs: document["Execution Time"],
    nodes: compactPlan(document.Plan),
  };
}

async function evaluateIndexTypes(sql: Sql) {
  await sql`drop table if exists private.recommendation_impression_index_benchmark`;
  await sql`
    create unlogged table private.recommendation_impression_index_benchmark (
      id uuid not null,
      shown_at timestamptz not null
    )
  `;
  try {
    await sql`
      insert into private.recommendation_impression_index_benchmark (id, shown_at)
      select id, shown_at from recommendation_impressions
    `;
    await sql`analyze private.recommendation_impression_index_benchmark`;
    await sql`
      create index recommendation_impression_index_benchmark_btree
      on private.recommendation_impression_index_benchmark(shown_at, id)
    `;
    const [btreeSize] = await sql<{ bytes: string }[]>`
      select pg_relation_size(
        'private.recommendation_impression_index_benchmark_btree'
      )::text as bytes
    `;
    const btree = await explainIndexCandidate(sql);
    await sql`drop index private.recommendation_impression_index_benchmark_btree`;

    await sql`
      create index recommendation_impression_index_benchmark_brin
      on private.recommendation_impression_index_benchmark
      using brin(shown_at)
    `;
    const [brinSize] = await sql<{ bytes: string }[]>`
      select pg_relation_size(
        'private.recommendation_impression_index_benchmark_brin'
      )::text as bytes
    `;
    const brin = await explainIndexCandidate(sql);
    return {
      brin: { ...brin, bytes: Number(brinSize?.bytes ?? 0) },
      btree: { ...btree, bytes: Number(btreeSize?.bytes ?? 0) },
      decision:
        "B-tree retained because the bounded delete requires (shown_at, id) order; BRIN is smaller but cannot satisfy that keyset order.",
    };
  } finally {
    await sql`drop table if exists private.recommendation_impression_index_benchmark`;
  }
}

async function seedScenario(
  sql: Sql,
  ownerId: string,
  paperId: string,
  expiredCount: number,
) {
  const freshCount = Math.max(1_000, Math.ceil(expiredCount / 10));
  await sql`
    insert into profiles (owner_id, display_name)
    values (${ownerId}, 'Recommendation retention benchmark')
  `;
  await sql`
    insert into papers (id, title, abstract, year, source, url, access)
    values (
      ${paperId}::uuid,
      'Recommendation retention benchmark paper',
      'Disposable local benchmark fixture.',
      2026,
      'manual',
      ${`https://example.invalid/recommendation-retention/${paperId}`},
      'open'
    )
  `;
  await sql`
    insert into recommendation_batch_items (
      id,
      owner_id,
      paper_id,
      batch_id,
      rank,
      score,
      model_version,
      delivered_at
    )
    select
      gen_random_uuid(),
      ${ownerId},
      ${paperId}::uuid,
      gen_random_uuid(),
      generated.position,
      1,
      'retention-benchmark',
      case
        when generated.position <= ${expiredCount} then ${expiredAt.toISOString()}::timestamptz
        else ${freshAt.toISOString()}::timestamptz
      end
    from generate_series(1, ${expiredCount + freshCount}) as generated(position)
  `;
  await sql`
    insert into recommendation_impressions (
      id,
      owner_id,
      paper_id,
      batch_item_id,
      batch_id,
      rank,
      score,
      model_version,
      shown_at
    )
    select
      gen_random_uuid(),
      batch_item.owner_id,
      batch_item.paper_id,
      batch_item.id,
      batch_item.batch_id,
      batch_item.rank,
      batch_item.score,
      batch_item.model_version,
      batch_item.delivered_at
    from recommendation_batch_items as batch_item
    where batch_item.owner_id = ${ownerId}
  `;
  await sql`analyze recommendation_impressions`;
  await sql`analyze recommendation_batch_items`;
  return freshCount;
}

async function cleanupScenario(sql: Sql, ownerId: string, paperId: string) {
  await sql`delete from profiles where owner_id = ${ownerId}`;
  await sql`delete from papers where id = ${paperId}::uuid`;
  await sql.unsafe("vacuum (analyze) recommendation_impressions");
  await sql.unsafe("vacuum (analyze) recommendation_batch_items");
}

async function benchmarkScale(expiredCount: number) {
  const ownerId = `recommendation-retention-benchmark-${randomUUID()}`;
  const paperId = randomUUID();
  const applicationName = `paperdeck-retention-benchmark-${expiredCount}`;
  const sql = postgres(databaseUrl, {
    connection: { application_name: applicationName },
    max: 1,
    onnotice: () => undefined,
    prepare: false,
  });
  const monitorSql = postgres(databaseUrl, { max: 1, prepare: false });
  const locker = postgres(databaseUrl, { max: 1, prepare: false });
  let monitorActive = true;
  let lockWaitSamples = 0;
  let monitorSamples = 0;
  const batchMetrics: RecommendationAnalyticsBatch[] = [];

  const monitor = (async () => {
    while (monitorActive) {
      const rows = await monitorSql<{ waiting: boolean }[]>`
        select exists (
          select 1
          from pg_stat_activity
          where application_name = ${applicationName}
            and wait_event_type = 'Lock'
        ) as waiting
      `;
      monitorSamples += 1;
      if (rows[0]?.waiting) lockWaitSamples += 1;
      await delay(monitorIntervalMs);
    }
  })();

  try {
    const seedStartedAt = performance.now();
    const freshCount = await seedScenario(sql, ownerId, paperId, expiredCount);
    const seedDurationMs = performance.now() - seedStartedAt;
    const healthBefore = await tableHealth(sql);
    const indexEvaluation =
      expiredCount === 1_000_000 ? await evaluateIndexTypes(sql) : undefined;
    if (indexEvaluation) {
      console.log(
        JSON.stringify({
          expiredRows: expiredCount,
          mode: "index-evaluation",
          ...indexEvaluation,
        }),
      );
    }
    const [locked] = await sql<{ id: string }[]>`
      select id
      from recommendation_impressions
      where owner_id = ${ownerId}
        and shown_at < ${cutoff.toISOString()}
      order by shown_at, id
      limit 1
    `;
    if (!locked) throw new Error("Missing expired benchmark impression.");
    const { firstPass, firstPassDurationMs, walStart } = await locker.begin(
      async (transaction) => {
        await transaction`
          select id
          from recommendation_impressions
          where id = ${locked.id}::uuid
          for update
        `;

        const [walStart] = await sql<{ lsn: string }[]>`
          select pg_current_wal_insert_lsn()::text as lsn
        `;
        const pruneStartedAt = performance.now();
        const firstPass = await pruneExpiredRecommendationAnalytics({
          batchSize,
          cutoff,
          maxBatches: 1_000,
          onBatch: (batch) => batchMetrics.push(batch),
          sql,
        });
        const firstPassDurationMs = performance.now() - pruneStartedAt;
        if (!firstPass.truncated) {
          throw new Error("Locked-row benchmark pass did not report truncation.");
        }
        return { firstPass, firstPassDurationMs, walStart: walStart.lsn };
      },
    );
    const resumeStartedAt = performance.now();
    const resumed = await pruneExpiredRecommendationAnalytics({
      batchSize,
      cutoff,
      maxBatches: 1_000,
      onBatch: (batch) => batchMetrics.push(batch),
      sql,
    });
    const pruneDurationMs =
      firstPassDurationMs + (performance.now() - resumeStartedAt);
    const [walEnd] = await sql<{ bytes: string }[]>`
      select pg_wal_lsn_diff(
        pg_current_wal_insert_lsn(),
        ${walStart}::pg_lsn
      )::text as bytes
    `;
    const walBytes = Number(walEnd.bytes);
    const deletedImpressions =
      firstPass.impressions.deletedCount + resumed.impressions.deletedCount;
    const deletedBatchItems =
      firstPass.batchItems.deletedCount + resumed.batchItems.deletedCount;
    if (deletedImpressions !== expiredCount || deletedBatchItems !== expiredCount) {
      throw new Error(
        `Unexpected deleted counts: ${deletedImpressions} impressions, ${deletedBatchItems} batch items.`,
      );
    }
    if (resumed.truncated) throw new Error("Resumed benchmark prune was truncated.");

    await sql`analyze recommendation_impressions`;
    await sql`analyze recommendation_batch_items`;
    const healthAfterDelete = await tableHealth(sql);
    const [remaining] = await sql<{
      batch_items: number;
      expired_batch_items: number;
      expired_impressions: number;
      impressions: number;
      indexes_valid: boolean;
    }[]>`
      select
        (select count(*)::integer from recommendation_batch_items where owner_id = ${ownerId}) as batch_items,
        (
          select count(*)::integer
          from recommendation_batch_items
          where owner_id = ${ownerId}
            and delivered_at < ${cutoff.toISOString()}
        ) as expired_batch_items,
        (
          select count(*)::integer
          from recommendation_impressions
          where owner_id = ${ownerId}
            and shown_at < ${cutoff.toISOString()}
        ) as expired_impressions,
        (select count(*)::integer from recommendation_impressions where owner_id = ${ownerId}) as impressions,
        (
          select bool_and(index_state.indisvalid and index_state.indisready)
          from pg_index as index_state
          join pg_class as index_relation on index_relation.oid = index_state.indexrelid
          where index_relation.relname in (
            'recommendation_impressions_shown_id_idx',
            'recommendation_batch_items_delivered_id_idx'
          )
        ) as indexes_valid
    `;
    if (
      remaining.expired_batch_items !== 0 ||
      remaining.expired_impressions !== 0 ||
      remaining.batch_items !== freshCount ||
      remaining.impressions !== freshCount ||
      !remaining.indexes_valid
    ) {
      throw new Error(`Unhealthy post-prune state: ${JSON.stringify(remaining)}`);
    }

    await sql.unsafe("vacuum (analyze) recommendation_impressions");
    await sql.unsafe("vacuum (analyze) recommendation_batch_items");
    const healthAfterVacuum = await tableHealth(sql);
    const mutationDurations = batchMetrics
      .filter(({ deletedCount }) => deletedCount > 0)
      .map(({ durationMs }) => durationMs);
    const impressionDurations = batchMetrics
      .filter(
        ({ deletedCount, table }) =>
          table === "impressions" && deletedCount > 0,
      )
      .map(({ durationMs }) => durationMs);
    const batchItemDurations = batchMetrics
      .filter(
        ({ deletedCount, table }) =>
          table === "batch-items" && deletedCount > 0,
      )
      .map(({ durationMs }) => durationMs);

    console.log(
      JSON.stringify({
        batchItemTransactions: batchItemDurations.length,
        batchSize,
        expiredRows: expiredCount,
        freshRowsPreserved: freshCount,
        impressionTransactions: impressionDurations.length,
        lockMonitor: {
          intervalMs: monitorIntervalMs,
          lockWaitObservedMs: lockWaitSamples * monitorIntervalMs,
          lockWaitSamples,
          samples: monitorSamples,
        },
        maxBatchTransactionMs: Number(
          Math.max(...mutationDurations).toFixed(2),
        ),
        maxBatchItemTransactionMs: Number(
          Math.max(...batchItemDurations).toFixed(2),
        ),
        maxImpressionTransactionMs: Number(
          Math.max(...impressionDurations).toFixed(2),
        ),
        p95BatchTransactionMs: Number(
          percentile(mutationDurations, 0.95).toFixed(2),
        ),
        pruneDurationMs: Number(pruneDurationMs.toFixed(2)),
        rowsPerSecond: Math.round(
          ((deletedImpressions + deletedBatchItems) * 1_000) / pruneDurationMs,
        ),
        seedDurationMs: Number(seedDurationMs.toFixed(2)),
        walBytes,
        mode: "performance",
      }),
    );
    console.log(
      JSON.stringify({
        expiredRows: expiredCount,
        healthAfterDelete,
        healthAfterVacuum,
        healthBefore,
        mode: "post-prune-health",
      }),
    );
  } finally {
    monitorActive = false;
    await monitor;
    await cleanupScenario(sql, ownerId, paperId);
    await Promise.all([locker.end(), monitorSql.end(), sql.end()]);
  }
}

async function main() {
  for (const scale of scales) {
    await benchmarkScale(scale);
  }
  console.log(
    JSON.stringify({
      batchSize,
      mode: "recommendation-analytics-retention-benchmark",
      scales,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
