import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createRuntimePool } from "@/db/runtime-pool";

const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.PAPERDECK_RUN_RUNTIME_POOL_INTEGRATION === "true";
const run = databaseUrl && enabled ? test : test.skip;
const pool = databaseUrl
  ? createRuntimePool(databaseUrl, {
      maxConnections: 1,
      statementTimeoutMs: 100,
      queryTimeoutMs: 1_000,
      slowQueryMs: 25,
      slowPoolWaitMs: 10,
    })
  : undefined;

after(async () => {
  await pool?.end();
});

run("a timed-out statement releases the bounded pool for queued work", async () => {
  assert.ok(pool);
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (line?: unknown) => warnings.push(String(line));

  try {
    const slowQuery = pool.query("select pg_sleep(0.5)");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const queuedQuery = pool.query<{ value: number }>("select 1 as value");
    const [slowResult, queuedResult] = await Promise.allSettled([
      slowQuery,
      queuedQuery,
    ]);

    assert.equal(slowResult.status, "rejected");
    assert.equal((slowResult.reason as { code?: string }).code, "57014");
    assert.equal(queuedResult.status, "fulfilled");
    if (queuedResult.status === "fulfilled") {
      assert.equal(queuedResult.value.rows[0]?.value, 1);
    }
  } finally {
    console.warn = originalWarn;
  }

  const events = warnings.map((line) => JSON.parse(line) as Record<string, unknown>);
  const timeout = events.find((event) => event.event === "database_query_timeout");
  const acquisition = events.find(
    (event) =>
      event.event === "database_pool_acquire" &&
      event.saturatedAtStart === true,
  );

  assert.ok(timeout, "expected a structured query-timeout diagnostic");
  assert.equal(timeout.statementTimeoutMs, 100);
  assert.equal(typeof timeout.poolTotal, "number");
  assert.equal("sql" in timeout, false);
  assert.equal("connectionString" in timeout, false);
  assert.ok(acquisition, "expected a structured pool-wait diagnostic");
  assert.ok(Number(acquisition.waitMs) >= 10);
  assert.equal(acquisition.outcome, "acquired");
  assert.equal(typeof acquisition.poolWaiting, "number");
});
