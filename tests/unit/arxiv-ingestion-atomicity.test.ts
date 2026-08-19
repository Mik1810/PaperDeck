import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  collectRevisionPages,
  createRequestRateGate,
  hasPassedRevisionCursorTimestamp,
  isAfterRevisionCursor,
  mapWithConcurrency,
  nextRevisionPageBudget,
  parseIntegerInRange,
  revisionCatchUpCheckpoint,
  withWholePaperRetry,
} from "../../scripts/lib/arxiv-ingestion";

const ingestionSource = readFileSync(
  new URL("../../scripts/ingest-arxiv.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL(
    "../../supabase/migrations/20260812202052_atomic_arxiv_paper_ingestion.sql",
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

test("revision catch-up expands its bounded scan and resumes without cursor gaps", async () => {
  const cursor = {
    last_seen_external_id: "2401.00001",
    last_seen_updated_at: "2026-08-01T00:00:00.000Z",
  };
  const pages = [
    [
      { arxivId: "2608.00004", updatedAt: "2026-08-04T00:00:00.000Z" },
      { arxivId: "2608.00003", updatedAt: "2026-08-03T00:00:00.000Z" },
    ],
    [
      { arxivId: "2608.00002", updatedAt: "2026-08-02T00:00:00.000Z" },
      { arxivId: "2608.00001", updatedAt: "2026-08-01T12:00:00.000Z" },
    ],
    [
      { arxivId: "2401.00001", updatedAt: "2026-08-01T00:00:00.000Z" },
      { arxivId: "2312.99999", updatedAt: "2026-07-31T00:00:00.000Z" },
    ],
  ];

  const firstRun = await collectRevisionPages({
    configuredPages: 2,
    cursor,
    fetchPage: async (page) => pages[page] ?? [],
    maxResults: 2,
    storedProgress: null,
  });
  assert.equal(firstRun.revisionComplete, false);
  assert.equal(firstRun.pageBudget, 2);
  assert.equal(firstRun.importablePapers.length, 4);
  assert.deepEqual(revisionCatchUpCheckpoint(cursor, firstRun.pageBudget), {
    cursorValue: "2",
    lastSeenExternalId: "2401.00001",
    lastSeenUpdatedAt: "2026-08-01T00:00:00.000Z",
  });

  const fetchedPages: number[] = [];
  const resumedRun = await collectRevisionPages({
    configuredPages: 2,
    cursor,
    fetchPage: async (page) => {
      fetchedPages.push(page);
      return pages[page] ?? [];
    },
    maxResults: 2,
    storedProgress: String(firstRun.pageBudget),
  });
  assert.equal(resumedRun.revisionComplete, true);
  assert.equal(resumedRun.pageBudget, 4);
  assert.deepEqual(fetchedPages, [0, 1, 2]);
  assert.equal(resumedRun.importablePapers.length, 4);
});

test("revision catch-up ignores legacy cursor values and caps exponential growth", () => {
  assert.equal(nextRevisionPageBudget(10, "2026-08-12T17:58:33Z"), 10);
  assert.equal(nextRevisionPageBudget(10, "10"), 20);
  assert.equal(nextRevisionPageBudget(10, "400"), 500);
  assert.equal(nextRevisionPageBudget(10, "500"), 500);
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
