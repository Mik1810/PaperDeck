import { performance } from "node:perf_hooks";
import type { Sql } from "postgres";

export const DEFAULT_RECOMMENDATION_ANALYTICS_BATCH_SIZE = 10_000;
export const DEFAULT_RECOMMENDATION_ANALYTICS_MAX_BATCHES = 100;

export type RecommendationAnalyticsTable = "batch-items" | "impressions";

export type RecommendationAnalyticsBatch = {
  deletedCount: number;
  durationMs: number;
  table: RecommendationAnalyticsTable;
};

type BatchResult = {
  batches: number;
  deletedCount: number;
  maxBatchDurationMs: number;
  statements: number;
  truncated: boolean;
};

export type RecommendationAnalyticsPruneResult = {
  batchItems: BatchResult;
  impressions: BatchResult;
  truncated: boolean;
};

export function parsePositiveInteger(
  value: string,
  label: string,
  maximum: number,
) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${label} must be an integer from 1 to ${maximum}.`);
  }
  return parsed;
}

export async function deleteExpiredImpressionBatch(
  sql: Sql,
  cutoff: Date,
  batchSize: number,
) {
  const result = await sql`
    with expired as materialized (
      select impression.id
      from recommendation_impressions as impression
      where impression.shown_at < ${cutoff.toISOString()}
      order by impression.shown_at, impression.id
      limit ${batchSize}
      for update skip locked
    )
    delete from recommendation_impressions as impression
    using expired
    where impression.id = expired.id
  `;
  return Number(result.count ?? 0);
}

export async function deleteExpiredBatchItemBatch(
  sql: Sql,
  cutoff: Date,
  batchSize: number,
) {
  const result = await sql`
    with expired as materialized (
      select batch_item.id
      from recommendation_batch_items as batch_item
      where batch_item.delivered_at < ${cutoff.toISOString()}
        and not exists (
          select 1
          from recommendation_impressions as impression
          where impression.batch_item_id = batch_item.id
        )
      order by batch_item.delivered_at, batch_item.id
      limit ${batchSize}
      for update skip locked
    )
    delete from recommendation_batch_items as batch_item
    using expired
    where batch_item.id = expired.id
  `;
  return Number(result.count ?? 0);
}

async function hasExpiredImpressions(sql: Sql, cutoff: Date) {
  const rows = await sql<{ remaining: boolean }[]>`
    select exists (
      select 1
      from recommendation_impressions
      where shown_at < ${cutoff.toISOString()}
    ) as remaining
  `;
  return rows[0]?.remaining ?? false;
}

async function hasExpiredBatchItems(sql: Sql, cutoff: Date) {
  const rows = await sql<{ remaining: boolean }[]>`
    select exists (
      select 1
      from recommendation_batch_items as batch_item
      where batch_item.delivered_at < ${cutoff.toISOString()}
        and not exists (
          select 1
          from recommendation_impressions as impression
          where impression.batch_item_id = batch_item.id
        )
    ) as remaining
  `;
  return rows[0]?.remaining ?? false;
}

async function pruneTable({
  batchSize,
  deleteBatch,
  hasRemaining,
  maxBatches,
  onBatch,
  table,
}: {
  batchSize: number;
  deleteBatch: () => Promise<number>;
  hasRemaining: () => Promise<boolean>;
  maxBatches: number;
  onBatch?: (batch: RecommendationAnalyticsBatch) => void;
  table: RecommendationAnalyticsTable;
}): Promise<BatchResult> {
  let batches = 0;
  let deletedCount = 0;
  let maxBatchDurationMs = 0;
  let statements = 0;

  while (statements < maxBatches) {
    const startedAt = performance.now();
    const batchDeleted = await deleteBatch();
    const durationMs = performance.now() - startedAt;
    statements += 1;
    deletedCount += batchDeleted;
    maxBatchDurationMs = Math.max(maxBatchDurationMs, durationMs);
    if (batchDeleted > 0) batches += 1;
    onBatch?.({ deletedCount: batchDeleted, durationMs, table });

    if (batchDeleted < batchSize) {
      return {
        batches,
        deletedCount,
        maxBatchDurationMs,
        statements,
        truncated: await hasRemaining(),
      };
    }
  }

  return {
    batches,
    deletedCount,
    maxBatchDurationMs,
    statements,
    truncated: await hasRemaining(),
  };
}

export async function pruneExpiredRecommendationAnalytics({
  batchSize,
  cutoff,
  maxBatches,
  onBatch,
  sql,
}: {
  batchSize: number;
  cutoff: Date;
  maxBatches: number;
  onBatch?: (batch: RecommendationAnalyticsBatch) => void;
  sql: Sql;
}): Promise<RecommendationAnalyticsPruneResult> {
  const impressions = await pruneTable({
    batchSize,
    deleteBatch: () => deleteExpiredImpressionBatch(sql, cutoff, batchSize),
    hasRemaining: () => hasExpiredImpressions(sql, cutoff),
    maxBatches,
    onBatch,
    table: "impressions",
  });
  const batchItems = await pruneTable({
    batchSize,
    deleteBatch: () => deleteExpiredBatchItemBatch(sql, cutoff, batchSize),
    hasRemaining: () => hasExpiredBatchItems(sql, cutoff),
    maxBatches,
    onBatch,
    table: "batch-items",
  });

  return {
    batchItems,
    impressions,
    truncated: impressions.truncated || batchItems.truncated,
  };
}

export async function countExpiredRecommendationAnalytics(
  sql: Sql,
  cutoff: Date,
) {
  const rows = await sql<{
    batch_item_count: string;
    impression_count: string;
  }[]>`
    select
      (
        select count(*)::text
        from recommendation_batch_items as batch_item
        where batch_item.delivered_at < ${cutoff.toISOString()}
          and not exists (
            select 1
            from recommendation_impressions as impression
            where impression.batch_item_id = batch_item.id
              and impression.shown_at >= ${cutoff.toISOString()}
          )
      ) as batch_item_count,
      (
        select count(*)::text
        from recommendation_impressions
        where shown_at < ${cutoff.toISOString()}
      ) as impression_count
  `;

  return {
    batchItemCount: Number(rows[0]?.batch_item_count ?? 0),
    impressionCount: Number(rows[0]?.impression_count ?? 0),
  };
}
