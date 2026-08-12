import { loadEnvConfig } from "@next/env";
import postgres from "postgres";
import {
  countExpiredRecommendationAnalytics,
  DEFAULT_RECOMMENDATION_ANALYTICS_BATCH_SIZE,
  DEFAULT_RECOMMENDATION_ANALYTICS_MAX_BATCHES,
  parsePositiveInteger,
  pruneExpiredRecommendationAnalytics,
} from "./lib/recommendation-analytics-retention";

loadEnvConfig(process.cwd());

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const batchSize = parsePositiveInteger(
    args.find((arg) => arg.startsWith("--batch-size="))?.split("=")[1] ??
      String(DEFAULT_RECOMMENDATION_ANALYTICS_BATCH_SIZE),
    "Recommendation analytics purge batch size",
    10_000,
  );
  const maxBatches = parsePositiveInteger(
    args.find((arg) => arg.startsWith("--max-batches="))?.split("=")[1] ??
      String(DEFAULT_RECOMMENDATION_ANALYTICS_MAX_BATCHES),
    "Recommendation analytics purge maximum batches",
    10_000,
  );
  const daysArg = args.find((arg) => arg.startsWith("--days="));
  const rawDays =
    daysArg?.replace("--days=", "") ??
    process.env.RECOMMENDATION_IMPRESSION_RETENTION_DAYS ??
    "90";
  const days = Number(rawDays);

  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`Invalid retention days: ${rawDays}`);
  }

  return { batchSize, days, dryRun, maxBatches };
}

async function main() {
  const { batchSize, days, dryRun, maxBatches } = parseArgs();
  const databaseUrl =
    process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required");
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sql = postgres(databaseUrl, { max: 1, prepare: false });

  try {
    if (dryRun) {
      const counts = await countExpiredRecommendationAnalytics(sql, cutoff);

      console.log(
        JSON.stringify({
          mode: "dry-run",
          retentionDays: days,
          cutoff: cutoff.toISOString(),
          prunableBatchItemCount: counts.batchItemCount,
          prunableImpressionCount: counts.impressionCount,
        }),
      );
      return;
    }

    await sql.unsafe("set lock_timeout = '5s'");
    await sql.unsafe("set statement_timeout = '30s'");
    const deleted = await pruneExpiredRecommendationAnalytics({
      batchSize,
      cutoff,
      maxBatches,
      sql,
    });

    console.log(
      JSON.stringify({
        mode: "write",
        retentionDays: days,
        cutoff: cutoff.toISOString(),
        batchSize,
        maxBatches,
        deletedBatchItemCount: deleted.batchItems.deletedCount,
        deletedImpressionCount: deleted.impressions.deletedCount,
        batchItemBatches: deleted.batchItems.batches,
        impressionBatches: deleted.impressions.batches,
        maxBatchItemTransactionMs: Number(
          deleted.batchItems.maxBatchDurationMs.toFixed(2),
        ),
        maxImpressionTransactionMs: Number(
          deleted.impressions.maxBatchDurationMs.toFixed(2),
        ),
        truncated: deleted.truncated,
      }),
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
