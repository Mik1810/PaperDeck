import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
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

type QueryMetrics = {
  queryCount: number;
  resultBytes: number;
  sqlMs: number;
};

type QueryResultLike = { rows?: unknown[] };

let activeMetrics: QueryMetrics | null = null;
const poolPrototype = pg.Pool.prototype as unknown as {
  query: (...args: unknown[]) => unknown;
};
const originalPoolQuery = poolPrototype.query;

poolPrototype.query = function instrumentedPoolQuery(...args: unknown[]) {
  const metrics = activeMetrics;
  const startedAt = nodePerformance.now();
  if (metrics) metrics.queryCount += 1;
  const result = originalPoolQuery.apply(this, args) as
    | Promise<QueryResultLike>
    | QueryResultLike;

  if (result && typeof (result as Promise<QueryResultLike>).then === "function") {
    return (result as Promise<QueryResultLike>).then((queryResult) => {
      if (metrics) {
        metrics.sqlMs += nodePerformance.now() - startedAt;
        metrics.resultBytes += Buffer.byteLength(
          JSON.stringify(queryResult.rows ?? []),
        );
      }
      return queryResult;
    });
  }

  const immediateResult = result as QueryResultLike;
  if (metrics) {
    metrics.sqlMs += nodePerformance.now() - startedAt;
    metrics.resultBytes += Buffer.byteLength(
      JSON.stringify(immediateResult.rows ?? []),
    );
  }
  return immediateResult;
};

const ownerId = `group-benchmark-${randomUUID()}`;
const groupId = randomUUID();
const publicId = randomUUID();
const paperIds = Array.from({ length: 500 }, () => randomUUID());
const sql = postgres(databaseUrl, { max: 4, prepare: false });
const repositoryRuns = 20;
const browserRuns = 10;
let previousReadsEnabled = false;

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function roundedPercentile(values: number[], ratio: number) {
  return Number(percentile(values, ratio).toFixed(2));
}

async function cleanupFixtures() {
  await sql`delete from research_groups where id = ${groupId}::uuid`;
  await sql`delete from profiles where owner_id = ${ownerId}`;
  await sql`delete from papers where id in ${sql(paperIds)}`;
}

async function seedCatalog() {
  await cleanupFixtures();
  const settings = await sql<{ reads_enabled: boolean }[]>`
    select reads_enabled
    from private.research_group_runtime_settings
    where singleton
  `;
  previousReadsEnabled = Boolean(settings[0]?.reads_enabled);
  await sql`
    update private.research_group_runtime_settings
    set reads_enabled = true, updated_at = now()
    where singleton
  `;
  await sql`
    insert into profiles (owner_id, display_name, onboarding_completed_at)
    values (${ownerId}, 'Group pagination benchmark', now())
  `;
  await sql`
    insert into collaboration_identities (
      owner_id,
      public_id,
      email_lookup_hash,
      discoverable_by_email,
      group_invite_policy
    ) values (
      ${ownerId},
      ${publicId}::uuid,
      encode(digest(${ownerId}, 'sha256'), 'hex'),
      false,
      'nobody'
    )
  `;
  await sql.begin(async (transaction) => {
    await transaction`
      insert into research_groups (id, name, description)
      values (
        ${groupId}::uuid,
        'Group pagination benchmark',
        'Disposable local performance fixture.'
      )
    `;
    await transaction`
      insert into research_group_members (group_id, member_id, role)
      values (${groupId}::uuid, ${ownerId}, 'owner')
    `;
  });

  const paperRows = paperIds.map((id, index) => ({
    abstract:
      `Synthetic research-group benchmark abstract ${index}. ` +
      "This local-only text approximates a concise catalog abstract payload. ".repeat(
        4,
      ),
    access: "open",
    id,
    source: "manual",
    title: `Group benchmark paper ${index.toString().padStart(3, "0")}`,
    url: `https://example.invalid/group-benchmark/${index}`,
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

  const authorRows = paperIds.flatMap((paperId, index) => [
    { name: `Synthetic Author ${index}`, paper_id: paperId, position: 0 },
    { name: "Benchmark Collaborator", paper_id: paperId, position: 1 },
  ]);
  await sql`
    insert into paper_authors ${sql(
      authorRows,
      "paper_id",
      "name",
      "position",
    )}
  `;
}

async function seedScenario(paperCount: number) {
  await sql`delete from research_group_paper_items where group_id = ${groupId}::uuid`;
  const rows = paperIds.slice(0, paperCount).map((paperId, index) => ({
    added_at: new Date(Date.UTC(2026, 7, 12, 12) - index * 1000),
    added_by: ownerId,
    group_id: groupId,
    paper_id: paperId,
  }));
  await sql`
    insert into research_group_paper_items ${sql(
      rows,
      "group_id",
      "paper_id",
      "added_by",
      "added_at",
    )}
  `;
}

async function freePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a benchmark port"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForServer(baseUrl: string, process: ChildProcess) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`Next.js benchmark server exited with ${process.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/groups`, {
        redirect: "manual",
      });
      if (response.status < 500) return;
    } catch {
      // The disposable local server is still compiling or binding.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for the Next.js benchmark server");
}

async function startBenchmarkServer() {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.platform === "win32"
      ? "node_modules/.bin/next.cmd"
      : "node_modules/.bin/next",
    ["dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_MAX_CONNECTIONS: "1",
        DATABASE_URL: databaseUrl,
        NEXT_PUBLIC_PAPERDECK_DEV_AUTH: "true",
        PAPERDECK_DEV_OWNER_ID: ownerId,
        TMPDIR: "/tmp",
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let errors = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    errors = `${errors}${chunk.toString("utf8")}`.slice(-4_000);
  });
  try {
    await waitForServer(baseUrl, child);
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${errors}`,
    );
  }
  return { baseUrl, child };
}

async function stopBenchmarkServer(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function measureBrowserScenario({
  baseUrl,
  expectedItems,
  page,
}: {
  baseUrl: string;
  expectedItems: number;
  page: Page;
}) {
  const initialHttpBytes: number[] = [];
  const navigationRscBytes: number[] = [];
  const renderMs: number[] = [];

  for (let run = 0; run < browserRuns; run += 1) {
    const initialResponse = await page.goto(`${baseUrl}/groups/${groupId}`, {
      waitUntil: "domcontentloaded",
    });
    if (!initialResponse?.ok()) {
      throw new Error(`Benchmark group page returned ${initialResponse?.status()}`);
    }
    initialHttpBytes.push((await initialResponse.body()).byteLength);

    await page.goto(`${baseUrl}/groups`, { waitUntil: "domcontentloaded" });
    const startedAt = nodePerformance.now();
    const [rscResponse] = await Promise.all([
      page.waitForResponse((response) => {
        const contentType = response.headers()["content-type"] ?? "";
        return (
          response.url().includes("_rsc=") ||
          contentType.includes("text/x-component")
        );
      }),
      page.getByRole("link", { name: /Group pagination benchmark/ }).click(),
    ]);
    await page.waitForFunction(
      (count) => document.querySelectorAll("article").length === count,
      expectedItems,
    );
    renderMs.push(nodePerformance.now() - startedAt);
    navigationRscBytes.push((await rscResponse.body()).byteLength);
  }

  return {
    initialHttpBytesP95: percentile(initialHttpBytes, 0.95),
    mobileRenderP95Ms: roundedPercentile(renderMs, 0.95),
    navigationRscBytesP95: percentile(navigationRscBytes, 0.95),
  };
}

async function measureRepositoryScenario() {
  const repository = await import(
    "../src/lib/repositories/research-group-workspace"
  );
  await repository.loadResearchGroupWorkspace(ownerId, groupId);

  const queryCounts: number[] = [];
  const resultBytes: number[] = [];
  const serializationMs: number[] = [];
  const sqlMs: number[] = [];
  const totalMs: number[] = [];
  const nextPageSqlMs: number[] = [];
  let workspace = await repository.loadResearchGroupWorkspace(ownerId, groupId);

  for (let run = 0; run < repositoryRuns; run += 1) {
    const metrics: QueryMetrics = { queryCount: 0, resultBytes: 0, sqlMs: 0 };
    activeMetrics = metrics;
    const startedAt = nodePerformance.now();
    try {
      workspace = await repository.loadResearchGroupWorkspace(ownerId, groupId);
    } finally {
      totalMs.push(nodePerformance.now() - startedAt);
      activeMetrics = null;
    }
    const serializationStartedAt = nodePerformance.now();
    JSON.stringify(workspace);
    serializationMs.push(nodePerformance.now() - serializationStartedAt);
    queryCounts.push(metrics.queryCount);
    resultBytes.push(metrics.resultBytes);
    sqlMs.push(metrics.sqlMs);

    if (workspace.paperPage.nextCursor) {
      const nextMetrics: QueryMetrics = {
        queryCount: 0,
        resultBytes: 0,
        sqlMs: 0,
      };
      activeMetrics = nextMetrics;
      try {
        await repository.loadResearchGroupPaperPage(
          ownerId,
          groupId,
          workspace.paperPage.nextCursor,
        );
      } finally {
        activeMetrics = null;
      }
      nextPageSqlMs.push(nextMetrics.sqlMs);
    }
  }

  return {
    firstPageItems: workspace.paperPage.items.length,
    firstPageResultBytesP95: percentile(resultBytes, 0.95),
    firstPageSqlP95Ms: roundedPercentile(sqlMs, 0.95),
    hasMore: Boolean(workspace.paperPage.nextCursor),
    nextPageSqlP95Ms: nextPageSqlMs.length
      ? roundedPercentile(nextPageSqlMs, 0.95)
      : null,
    queryCountP95: percentile(queryCounts, 0.95),
    repositoryP95Ms: roundedPercentile(totalMs, 0.95),
    serializationP95Ms: roundedPercentile(serializationMs, 0.95),
  };
}

async function main() {
  let browser: Browser | undefined;
  let server: ChildProcess | undefined;
  try {
    await seedCatalog();
    const runningServer = await startBenchmarkServer();
    server = runningServer.child;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      isMobile: true,
      viewport: { height: 844, width: 390 },
    });
    const page = await context.newPage();

    const results = [];
    for (const paperCount of [10, 100, 500]) {
      await seedScenario(paperCount);
      const repository = await measureRepositoryScenario();
      const browserMetrics = await measureBrowserScenario({
        baseUrl: runningServer.baseUrl,
        expectedItems: Math.min(paperCount, 40),
        page,
      });
      results.push({
        browserRuns,
        paperCount,
        repositoryRuns,
        ...repository,
        ...browserMetrics,
      });
    }
    process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
  } finally {
    activeMetrics = null;
    await browser?.close();
    await stopBenchmarkServer(server);
    await cleanupFixtures();
    await sql`
      update private.research_group_runtime_settings
      set reads_enabled = ${previousReadsEnabled}, updated_at = now()
      where singleton
    `;
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
