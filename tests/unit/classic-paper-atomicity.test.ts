import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const discoverySource = readFileSync(
  new URL("../../scripts/discover-classic-papers.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL(
    "../../supabase/migrations/20260819210000_atomic_classic_paper_persistence.sql",
    import.meta.url,
  ),
  "utf8",
);

test("classic persistence uses one whole-bundle RPC without table write chains", () => {
  const upsertPaperSource = discoverySource.slice(
    discoverySource.indexOf("async function upsertPaper"),
    discoverySource.indexOf("async function main"),
  );

  assert.match(upsertPaperSource, /rpc\("upsert_classic_paper_bundle"/);
  assert.equal(upsertPaperSource.match(/\.rpc\(/g)?.length, 1);
  assert.doesNotMatch(upsertPaperSource, /\.from\(/);
  assert.match(upsertPaperSource, /withWholePaperRetry/);
});

test("classic bundle RPC has the approved privilege and locking boundary", () => {
  assert.match(migrationSource, /security invoker\s+set search_path = ''/);
  assert.match(migrationSource, /pg_advisory_xact_lock/);
  assert.match(
    migrationSource,
    /revoke all on function public\.upsert_classic_paper_bundle\(jsonb\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migrationSource,
    /grant execute on function public\.upsert_classic_paper_bundle\(jsonb\)[\s\S]*to service_role/,
  );
});
