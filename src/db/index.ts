import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import * as relations from "./relations";

const globalForDb = globalThis as unknown as {
  db: ReturnType<typeof drizzle> | undefined;
};

function databaseMaxConnections() {
  const value = Number(process.env.DATABASE_MAX_CONNECTIONS ?? 1);

  if (!Number.isInteger(value) || value < 1) {
    return 1;
  }

  return value;
}

function createDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for Drizzle client");
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: databaseMaxConnections(),
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
  });

  return drizzle(pool, { schema: { ...schema, ...relations } });
}

export const db = globalForDb.db ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalForDb.db = db;
}
