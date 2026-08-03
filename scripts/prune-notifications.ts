import { loadEnvConfig } from "@next/env";
import postgres from "postgres";

loadEnvConfig(process.cwd());

function parsePositiveInteger(value: string, label: string, maximum: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${label} must be an integer from 1 to ${maximum}.`);
  }
  return parsed;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const batchSize = parsePositiveInteger(
    args.find((arg) => arg.startsWith("--batch-size="))?.split("=")[1] ??
      "1000",
    "Notification purge batch size",
    10_000,
  );
  const maxBatches = parsePositiveInteger(
    args.find((arg) => arg.startsWith("--max-batches="))?.split("=")[1] ??
      "100",
    "Notification purge maximum batches",
    1_000,
  );

  return { batchSize, dryRun, maxBatches };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const { batchSize, dryRun, maxBatches } = parseArgs();
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    if (dryRun) {
      const rows = await sql<{ count: number }[]>`
        select count(*)::integer as count
        from notifications
        where expires_at <= now()
      `;
      console.log(JSON.stringify({
        mode: "dry-run",
        retentionDays: 90,
        expiredCount: rows[0]?.count ?? 0,
      }));
      return;
    }

    let batches = 0;
    let deletedCount = 0;
    while (batches < maxBatches) {
      const rows = await sql<{ count: number }[]>`
        select private.purge_expired_notifications(${batchSize}) as count
      `;
      const batchDeleted = rows[0]?.count ?? 0;
      batches += 1;
      deletedCount += batchDeleted;
      if (batchDeleted < batchSize) break;
    }

    console.log(JSON.stringify({
      mode: "write",
      retentionDays: 90,
      batchSize,
      batches,
      deletedCount,
      truncated: batches === maxBatches && deletedCount === batchSize * maxBatches,
    }));
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Notification purge failed.");
  process.exit(1);
});
