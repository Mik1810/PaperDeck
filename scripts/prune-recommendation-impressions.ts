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
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    if (dryRun) {
      const rows = await sql<{ count: string }[]>`
        select count(*)::text as count
        from recommendation_impressions
        where shown_at < ${cutoff.toISOString()}
      `;

      console.log(
        JSON.stringify({
          mode: "dry-run",
          retentionDays: days,
          cutoff: cutoff.toISOString(),
          prunableCount: Number(rows[0]?.count ?? 0),
        }),
      );
      return;
    }

    const rows = await sql<{ id: string }[]>`
      delete from recommendation_impressions
      where shown_at < ${cutoff.toISOString()}
      returning id
    `;

    console.log(
      JSON.stringify({
        mode: "write",
        retentionDays: days,
        cutoff: cutoff.toISOString(),
        deletedCount: rows.length,
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
