import { loadEnvConfig } from "@next/env";
import postgres from "postgres";

loadEnvConfig(process.cwd());

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const daysArg = args.find((arg) => arg.startsWith("--days="));
  const rawDays =
    daysArg?.replace("--days=", "") ??
    process.env.RECOMMENDATION_IMPRESSION_RETENTION_DAYS ??
    "90";
  const days = Number(rawDays);

  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`Invalid retention days: ${rawDays}`);
  }

  return { days, dryRun };
}

async function main() {
  const { days, dryRun } = parseArgs();
  const databaseUrl =
    process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required");
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sql = postgres(databaseUrl, { max: 1, prepare: false });

  try {
    if (dryRun) {
      const rows = await sql<{
        batch_item_count: string;
        impression_count: string;
      }[]>`
        select
          (
            select count(*)::text
            from recommendation_batch_items as batch_item
            where delivered_at < ${cutoff.toISOString()}
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

      console.log(
        JSON.stringify({
          mode: "dry-run",
          retentionDays: days,
          cutoff: cutoff.toISOString(),
          prunableBatchItemCount: Number(rows[0]?.batch_item_count ?? 0),
          prunableImpressionCount: Number(rows[0]?.impression_count ?? 0),
        }),
      );
      return;
    }

    const deleted = await sql.begin(async (transaction) => {
      const impressions = await transaction<{ id: string }[]>`
        delete from recommendation_impressions
        where shown_at < ${cutoff.toISOString()}
        returning id
      `;
      const batchItems = await transaction<{ id: string }[]>`
        delete from recommendation_batch_items as batch_item
        where delivered_at < ${cutoff.toISOString()}
          and not exists (
            select 1
            from recommendation_impressions as impression
            where impression.batch_item_id = batch_item.id
          )
        returning id
      `;

      return {
        batchItemCount: batchItems.length,
        impressionCount: impressions.length,
      };
    });

    console.log(
      JSON.stringify({
        mode: "write",
        retentionDays: days,
        cutoff: cutoff.toISOString(),
        deletedBatchItemCount: deleted.batchItemCount,
        deletedImpressionCount: deleted.impressionCount,
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
