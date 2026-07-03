import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import * as relations from "./relations";

const globalForDb = globalThis as unknown as {
  db: ReturnType<typeof drizzle> | undefined;
};

function createDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for Drizzle client");
  }

  const client = postgres(process.env.DATABASE_URL, { max: 10 });

  return drizzle(client, { schema: { ...schema, ...relations } });
}

export const db = globalForDb.db ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalForDb.db = db;
}
