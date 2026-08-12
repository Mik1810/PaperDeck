import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createRequestRateGate,
  hasPassedRevisionCursorTimestamp,
  isAfterRevisionCursor,
  mapWithConcurrency,
  parseIntegerInRange,
  withWholePaperRetry,
} from "../../scripts/lib/arxiv-ingestion";

const ingestionSource = readFileSync(
  new URL("../../scripts/ingest-arxiv.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL(
    "../../supabase/migrations/20260812220000_atomic_arxiv_paper_ingestion.sql",
    import.meta.url,
  ),
  "utf8",
);

test("paper persistence uses one whole-bundle RPC without table write chains", () => {
  const upsertPaperSource = ingestionSource.slice(
    ingestionSource.indexOf("async function upsertPaper"),
    ingestionSource.indexOf("function uniquePapersByArxivId"),
  );
  assert.match(upsertPaperSource, /rpc\("upsert_arxiv_paper_bundle"/);
  assert.equal(upsertPaperSource.match(/\.rpc\(/g)?.length, 1);
  assert.doesNotMatch(upsertPaperSource, /\.from\(/);
  assert.match(upsertPaperSource, /withWholePaperRetry/);
});

test("atomic bundle RPC is service-role-only with an empty search path", () => {
  assert.match(migrationSource, /security invoker\s+set search_path = ''/);
  assert.match(
    migrationSource,
    /revoke all on function public\.upsert_arxiv_paper_bundle\(jsonb\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migrationSource,
    /grant execute on function public\.upsert_arxiv_paper_bundle\(jsonb\)[\s\S]*to service_role/,
  );
});

test("revision cursor uses the updated timestamp and arXiv id tie-breaker", () => {
  const cursor = {
    last_seen_external_id: "2401.00002",
    last_seen_updated_at: "2026-08-01T00:00:00.000Z",
  };
  assert.equal(
    isAfterRevisionCursor(
      { arxivId: "1999.00001", updatedAt: "2026-08-02T00:00:00.000Z" },
      cursor,
    ),
    true,
  );
  assert.equal(
    isAfterRevisionCursor(
      { arxivId: "2401.00003", updatedAt: "2026-08-01T00:00:00.000Z" },
      cursor,
    ),
    true,
  );
  assert.equal(
    isAfterRevisionCursor(
      { arxivId: "2401.00001", updatedAt: "2026-08-01T00:00:00.000Z" },
      cursor,
    ),
    false,
  );
  assert.equal(
    hasPassedRevisionCursorTimestamp(
      [
        { arxivId: "2401.00001", updatedAt: "2026-08-01T00:00:00.000Z" },
        { arxivId: "2401.99999", updatedAt: "2026-08-01T00:00:00.000Z" },
      ],
      cursor,
    ),
    false,
  );
  assert.equal(
    hasPassedRevisionCursorTimestamp(
      [{ arxivId: "2401.00001", updatedAt: "2026-07-31T23:59:59.000Z" }],
      cursor,
    ),
    true,
  );
});

test("database work is bounded while preserving result order", async () => {
  let active = 0;
  let maximumActive = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (item) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return item * 2;
  });
  assert.equal(maximumActive, 3);
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12]);
});

test("whole-paper retry repeats transient failures but not validation failures", async () => {
  let transientAttempts = 0;
  const retried = await withWholePaperRetry(
    async () => {
      transientAttempts += 1;
      if (transientAttempts < 3) throw { code: "40001" };
      return "saved";
    },
    { sleep: async () => undefined },
  );
  assert.equal(retried, "saved");
  assert.equal(transientAttempts, 3);

  let permanentAttempts = 0;
  await assert.rejects(
    withWholePaperRetry(async () => {
      permanentAttempts += 1;
      throw { code: "22023" };
    }),
  );
  assert.equal(permanentAttempts, 1);
});

test("one rate gate serializes every arXiv request independently of DB workers", async () => {
  let clock = 0;
  const starts: number[] = [];
  const gate = createRequestRateGate(3_100, {
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
  });
  await Promise.all(
    [0, 1, 2, 3].map(async () => {
      await gate();
      starts.push(clock);
    }),
  );
  assert.deepEqual(starts, [0, 3_100, 6_200, 9_300]);
});

test("network and database concurrency settings reject unsafe bounds", () => {
  assert.equal(parseIntegerInRange(3_000, "request delay", 3_000, 60_000), 3_000);
  assert.throws(
    () => parseIntegerInRange(2_999, "request delay", 3_000, 60_000),
    /3000 to 60000/,
  );
  assert.throws(
    () => parseIntegerInRange(Number.NaN, "request delay", 3_000, 60_000),
    /3000 to 60000/,
  );
});
