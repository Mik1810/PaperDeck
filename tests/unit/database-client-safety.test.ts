import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const databaseClientSource = readFileSync(
  new URL("../../src/db/index.ts", import.meta.url),
  "utf8",
);
const runtimePoolSource = readFileSync(
  new URL("../../src/db/runtime-pool.ts", import.meta.url),
  "utf8",
);

test("database client uses a bounded node-postgres pool", () => {
  assert.match(databaseClientSource, /drizzle-orm\/node-postgres/);
  assert.match(databaseClientSource, /createRuntimePool/);
  assert.match(runtimePoolSource, /max:\s*settings\.maxConnections/);
  assert.match(runtimePoolSource, /idleTimeoutMillis:\s*5_000/);
  assert.match(runtimePoolSource, /connectionTimeoutMillis:\s*10_000/);
  assert.match(runtimePoolSource, /statement_timeout:\s*settings\.statementTimeoutMs/);
  assert.match(runtimePoolSource, /query_timeout:\s*settings\.queryTimeoutMs/);
});
