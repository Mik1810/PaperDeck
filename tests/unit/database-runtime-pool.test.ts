import assert from "node:assert/strict";
import test from "node:test";
import { databaseRuntimeSettings } from "@/db/runtime-pool";

test("runtime database deadlines are stricter than the maintenance role default", () => {
  const settings = databaseRuntimeSettings({});

  assert.equal(settings.statementTimeoutMs, 15_000);
  assert.equal(settings.queryTimeoutMs, 18_000);
  assert.equal(settings.maxConnections, 1);
  assert.ok(settings.statementTimeoutMs < 120_000);
});

test("client query timeout remains a fail-safe above the statement timeout", () => {
  const settings = databaseRuntimeSettings({
    DATABASE_STATEMENT_TIMEOUT_MS: "4000",
    DATABASE_QUERY_TIMEOUT_MS: "1000",
    DATABASE_MAX_CONNECTIONS: "3",
    DATABASE_SLOW_QUERY_MS: "250",
    DATABASE_SLOW_POOL_WAIT_MS: "25",
  });

  assert.deepEqual(settings, {
    maxConnections: 3,
    statementTimeoutMs: 4000,
    queryTimeoutMs: 5000,
    slowQueryMs: 250,
    slowPoolWaitMs: 25,
  });
});
