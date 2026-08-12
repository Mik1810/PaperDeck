import { randomUUID } from "node:crypto";
import { performance as nodePerformance } from "node:perf_hooks";
import { loadEnvConfig } from "@next/env";
import { chromium, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import postgres from "postgres";
import { assertDisposableLocalDatabase } from "./local-database";

loadEnvConfig(process.cwd());

const DEFAULT_BENCHMARK_DATABASE_URL =
  "postgresql://paperdeck:paperdeck_local_only@127.0.0.1:55432/paperdeck_test";
const databaseUrl =
  process.env.PAPERDECK_TEST_DATABASE_URL ?? DEFAULT_BENCHMARK_DATABASE_URL;
assertDisposableLocalDatabase(databaseUrl, "paperdeck_test");
process.env.DATABASE_URL = databaseUrl;

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

const ownerId = `library-benchmark-${randomUUID()}`;
const paperIds = Array.from({ length: 1_000 }, () => randomUUID());
const sql = postgres(databaseUrl, { max: 4, prepare: false });
const runsPerScenario = 20;

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

async function cleanupFixtures() {
  await sql`delete from profiles where owner_id = ${ownerId}`;
  await sql`delete from papers where id in ${sql(paperIds)}`;
}

async function seedCatalog() {
  await cleanupFixtures();
  await sql`
    insert into profiles (owner_id, display_name)
    values (${ownerId}, 'Library benchmark fixture')
  `;
  const paperRows = paperIds.map((id, index) => ({
    abstract: `Synthetic Library benchmark abstract ${index}`,
    access: "open",
    id,
    source: "manual",
    title: `Library benchmark paper ${index.toString().padStart(4, "0")}`,
    url: `https://example.test/library-benchmark/${index}`,
    year: 2026,
  }));
  await sql`
    insert into papers ${sql(
      paperRows,
      "id",
      "title",
      "abstract",
      "year",
      "source",
      "url",
      "access",
    )}
  `;
}

async function seedScenario(
  selectedPaperCount: number,
  customPlaylistCount: number,
) {
  await sql`delete from playlists where owner_id = ${ownerId}`;
  const [defaultPlaylist] = await sql<{ id: string }[]>`
    insert into playlists (owner_id, name, is_default)
    values (${ownerId}, 'Read later', true)
    returning id
  `;
  const readLaterItems = paperIds
    .slice(0, selectedPaperCount)
    .map((paperId, position) => ({
      added_at: new Date(Date.UTC(2026, 7, 12, 12) - position * 1000),
      paper_id: paperId,
      playlist_id: defaultPlaylist.id,
      position,
    }));
  await sql`
    insert into playlist_items ${sql(
      readLaterItems,
      "playlist_id",
      "paper_id",
      "position",
      "added_at",
    )}
  `;

  if (!customPlaylistCount) return;
  const playlistRows = Array.from(
    { length: customPlaylistCount },
    (_, index) => ({
      is_default: false,
      name: `Benchmark playlist ${index.toString().padStart(3, "0")}`,
      owner_id: ownerId,
    }),
  );
  const customPlaylists = (await sql`
    insert into playlists ${sql(
      playlistRows,
      "owner_id",
      "name",
      "is_default",
    )}
    returning id
  `) as { id: string }[];
  const customItems = customPlaylists.flatMap((playlist, playlistIndex) =>
    paperIds
      .slice(playlistIndex % 50, (playlistIndex % 50) + 10)
      .map((paperId, position) => ({
        paper_id: paperId,
        playlist_id: playlist.id,
        position,
      })),
  );
  await sql`
    insert into playlist_items ${sql(
      customItems,
      "playlist_id",
      "paper_id",
      "position",
    )}
  `;
}

async function browserHeapForPayload(page: Page, payload: string) {
  const session = await page.context().newCDPSession(page);
  const samples: number[] = [];

  for (let index = 0; index < 5; index += 1) {
    await page.evaluate(() => {
      delete (window as typeof window & { __libraryBenchmark?: unknown })
        .__libraryBenchmark;
    });
    await session.send("HeapProfiler.collectGarbage");
    const before = await page.evaluate(
      () =>
        (
          performance as Performance & {
            memory: { usedJSHeapSize: number };
          }
        ).memory.usedJSHeapSize,
    );
    await page.evaluate((serialized) => {
      (window as typeof window & { __libraryBenchmark?: unknown })
        .__libraryBenchmark = JSON.parse(serialized);
    }, payload);
    await session.send("HeapProfiler.collectGarbage");
    const after = await page.evaluate(
      () =>
        (
          performance as Performance & {
            memory: { usedJSHeapSize: number };
          }
        ).memory.usedJSHeapSize,
    );
    samples.push(Math.max(0, after - before));
  }

  await session.detach();
  return Math.round(percentile(samples, 0.5));
}

async function benchmarkScenario({
  browserPage,
  customPlaylists,
  label,
  papers,
}: {
  browserPage: Page;
  customPlaylists: number;
  label: string;
  papers: number;
}) {
  await seedScenario(papers, customPlaylists);
  const repository = await import("../src/lib/repositories/user-data");

  await repository.getLibraryInitialData(ownerId, "read-later");
  await repository.getLibraryInitialData(ownerId, "read-later");

  const durations: number[] = [];
  const queryCounts: number[] = [];
  const transferredRows: number[] = [];
  let result = await repository.getLibraryInitialData(ownerId, "read-later");

  for (let index = 0; index < runsPerScenario; index += 1) {
    const metrics = { queryCount: 0, rows: 0 };
    activeMetrics = metrics;
    const startedAt = nodePerformance.now();
    try {
      result = await repository.getLibraryInitialData(ownerId, "read-later");
    } finally {
      durations.push(nodePerformance.now() - startedAt);
      activeMetrics = null;
    }
    queryCounts.push(metrics.queryCount);
    transferredRows.push(metrics.rows);
  }

  const serialized = JSON.stringify(result);
  const clientCacheHeapBytes = await browserHeapForPayload(
    browserPage,
    serialized,
  );
  const nodeWithGc = globalThis as typeof globalThis & { gc?: () => void };
  nodeWithGc.gc?.();

  return {
    clientCacheHeapBytes,
    customPlaylists,
    dbRowsP50: percentile(transferredRows, 0.5),
    hasMore: Boolean(result.initialCollectionPage.nextCursor),
    label,
    latencyP50Ms: Number(percentile(durations, 0.5).toFixed(2)),
    latencyP95Ms: Number(percentile(durations, 0.95).toFixed(2)),
    pageItems: result.initialCollectionPage.items.length,
    papers,
    queryCountP50: percentile(queryCounts, 0.5),
    responseBytes: Buffer.byteLength(serialized),
    runs: runsPerScenario,
  };
}

async function main() {
  let browser: Browser | undefined;
  try {
    await seedCatalog();
    browser = await chromium.launch({
      args: ["--enable-precise-memory-info"],
      headless: true,
    });
    const browserPage = await browser.newPage();
    await browserPage.goto("about:blank");

    const scenarios = [
      { customPlaylists: 0, label: "10 papers", papers: 10 },
      { customPlaylists: 0, label: "100 papers", papers: 100 },
      { customPlaylists: 0, label: "1,000 papers", papers: 1_000 },
      {
        customPlaylists: 100,
        label: "1,000 papers and 100 custom playlists",
        papers: 1_000,
      },
    ];
    const results = [];
    for (const scenario of scenarios) {
      results.push(await benchmarkScenario({ ...scenario, browserPage }));
    }
    process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
  } finally {
    activeMetrics = null;
    await browser?.close();
    await cleanupFixtures();
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
