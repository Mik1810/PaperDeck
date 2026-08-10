import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import pg from "pg";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");
const { Client } = pg;

export const DEFAULT_LOCAL_DATABASE_URL =
  "postgresql://paperdeck:paperdeck_local_only@127.0.0.1:55432/paperdeck_test";

const CATALOG_TABLES = [
  "public.taxonomy_topics",
  "public.topic_relations",
  "public.papers",
  "public.paper_authors",
  "public.paper_topics",
  "public.paper_external_ids",
  "public.topic_embeddings",
] as const;

export function assertDisposableLocalDatabase(databaseUrl: string) {
  let parsed: URL;

  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("The local database URL is not a valid URL.");
  }

  const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

  if (!localHosts.has(parsed.hostname)) {
    throw new Error(
      `Refusing destructive database setup on non-local host ${parsed.hostname}.`,
    );
  }

  if (parsed.pathname !== "/paperdeck_test") {
    throw new Error(
      "Refusing destructive database setup unless the database is named paperdeck_test.",
    );
  }

  return parsed;
}

function connectionEnvironment(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const sslMode = parsed.searchParams.get("sslmode");

  return {
    ...process.env,
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
    PGHOST: parsed.hostname.replace(/^\[|\]$/g, ""),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGPORT: parsed.port || "5432",
    PGSSLMODE: sslMode ?? (parsed.hostname === "localhost" ? "disable" : "require"),
    PGUSER: decodeURIComponent(parsed.username),
  };
}

async function run(command: string, args: string[], env = process.env) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with status ${code ?? "unknown"}.`));
    });
  });
}

async function resetSchema(databaseUrl: string) {
  assertDisposableLocalDatabase(databaseUrl);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      drop schema if exists public cascade;
      drop schema if exists private cascade;
      drop schema if exists auth cascade;
      create schema public;
      grant all on schema public to public;

      do $$
      begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then
          create role anon nologin;
        end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then
          create role authenticated nologin;
        end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then
          create role service_role nologin;
        end if;
      end
      $$;

      create schema auth;
      create function auth.jwt()
      returns jsonb
      language sql
      stable
      as $$
        select coalesce(
          nullif(current_setting('request.jwt.claims', true), ''),
          '{}'
        )::jsonb
      $$;
    `);

    const schema = await readFile(
      path.join(process.cwd(), "supabase", "schema.sql"),
      "utf8",
    );
    await client.query(schema);
  } finally {
    await client.end();
  }
}

async function applyFixture(databaseUrl: string) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const fixture = await readFile(
      path.join(process.cwd(), "tests", "fixtures", "app-e2e.sql"),
      "utf8",
    );
    await client.query(fixture);
  } finally {
    await client.end();
  }
}

async function reportCatalog(databaseUrl: string, source: "synthetic" | "snapshot") {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{
      papers: string;
      authors: string;
      topics: string;
      private_profiles: string;
    }>(`
      select
        (select count(*)::text from public.papers) as papers,
        (select count(*)::text from public.paper_authors) as authors,
        (select count(*)::text from public.taxonomy_topics) as topics,
        (select count(*)::text from public.profiles) as private_profiles
    `);
    const counts = result.rows[0];
    if (Number(counts.private_profiles) !== 0) {
      throw new Error(
        "Local database preparation unexpectedly retained private profiles.",
      );
    }
    console.log(
      JSON.stringify({
        database: "paperdeck_test@localhost",
        source,
        papers: Number(counts.papers),
        authors: Number(counts.authors),
        topics: Number(counts.topics),
        private_profiles: Number(counts.private_profiles),
      }),
    );
  } finally {
    await client.end();
  }
}

async function prepareSynthetic(databaseUrl: string) {
  await resetSchema(databaseUrl);
  await applyFixture(databaseUrl);
  await reportCatalog(databaseUrl, "synthetic");
}

async function refreshCatalog(databaseUrl: string) {
  const sourceUrl =
    process.env.PAPERDECK_CATALOG_SOURCE_DATABASE_URL ??
    process.env.DATABASE_ADMIN_URL;

  if (!sourceUrl) {
    throw new Error(
      "DATABASE_ADMIN_URL is required in .env.local to refresh the catalog snapshot.",
    );
  }

  const source = new URL(sourceUrl);
  if (["127.0.0.1", "localhost", "[::1]"].includes(source.hostname)) {
    throw new Error("The catalog snapshot source must be a remote database.");
  }

  await resetSchema(databaseUrl);

  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "paperdeck-catalog-snapshot-"),
  );
  const dumpPath = path.join(temporaryDirectory, "catalog.dump");

  try {
    await run(
      "pg_dump",
      [
        "--data-only",
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        ...CATALOG_TABLES.flatMap((table) => ["--table", table]),
        "--file",
        dumpPath,
      ],
      connectionEnvironment(sourceUrl),
    );
    await run(
      "pg_restore",
      [
        "--dbname",
        "paperdeck_test",
        "--data-only",
        "--no-owner",
        "--no-privileges",
        "--disable-triggers",
        "--exit-on-error",
        dumpPath,
      ],
      connectionEnvironment(databaseUrl),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  await reportCatalog(databaseUrl, "snapshot");
}

async function main() {
  loadEnvConfig(process.cwd());
  const command = process.argv[2];
  const databaseUrl =
    process.env.PAPERDECK_LOCAL_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL;
  assertDisposableLocalDatabase(databaseUrl);

  if (command === "prepare-test") {
    await prepareSynthetic(databaseUrl);
    return;
  }
  if (command === "refresh-catalog") {
    await refreshCatalog(databaseUrl);
    return;
  }

  throw new Error(
    "Usage: tsx scripts/local-database.ts <prepare-test|refresh-catalog>",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
