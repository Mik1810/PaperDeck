import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import * as relations from "./relations";
import { validateHostedDatabaseConfiguration } from "./runtime-config";
import { createRuntimePool } from "./runtime-pool";

const globalForDb = globalThis as unknown as {
  db: ReturnType<typeof drizzle> | undefined;
};

function createDb() {
  validateHostedDatabaseConfiguration();

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for Drizzle client");
  }

  const pool = createRuntimePool(process.env.DATABASE_URL);

  return drizzle(pool, { schema: { ...schema, ...relations } });
}

export const db = globalForDb.db ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalForDb.db = db;
}
