import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const databaseClientSource = readFileSync(
  new URL("../../src/db/index.ts", import.meta.url),
  "utf8",
);

test("database client uses a bounded node-postgres pool", () => {
  assert.match(databaseClientSource, /drizzle-orm\/node-postgres/);
  assert.match(databaseClientSource, /new Pool/);
  assert.match(databaseClientSource, /max:\s*databaseMaxConnections\(\)/);
  assert.match(databaseClientSource, /idleTimeoutMillis:\s*5_000/);
  assert.match(databaseClientSource, /connectionTimeoutMillis:\s*10_000/);
});
