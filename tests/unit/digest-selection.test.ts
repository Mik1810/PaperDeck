import assert from "node:assert/strict";
import test from "node:test";
import {
  type DigestRecencyCandidate,
  selectDigestPaperIdsByRecency,
} from "../../src/lib/digest-selection";

const dayMs = 24 * 60 * 60 * 1000;
const nowMs = Date.parse("2026-08-12T12:00:00.000Z");

function candidate(paperId: string, daysAgo: number): DigestRecencyCandidate {
  return {
    availableAt: new Date(nowMs - daysAgo * dayMs).toISOString(),
    paperId,
  };
}

async function select(
  rankedPaperIds: string[],
  candidates: DigestRecencyCandidate[],
) {
  const requestedWindows: number[] = [];
  const result = await selectDigestPaperIdsByRecency({
    loadCandidates: async (_paperIds, maximumWindowDays, requestedNowMs) => {
      assert.equal(requestedNowMs, nowMs);
      requestedWindows.push(maximumWindowDays);
      return candidates;
    },
    minimumPaperCount: 3,
    nowMs,
    rankedPaperIds,
  });

  return { requestedWindows, result };
}

test("dense catalogs choose the seven-day window with one maximum-window load", async () => {
  const { requestedWindows, result } = await select(
    ["rank-1", "rank-2", "rank-3", "rank-4"],
    [
      candidate("rank-3", 6),
      candidate("rank-1", 1),
      candidate("rank-4", 8),
      candidate("rank-2", 4),
    ],
  );

  assert.deepEqual(requestedWindows, [30]);
  assert.deepEqual(result, {
    paperIds: ["rank-1", "rank-2", "rank-3"],
    windowDays: 7,
  });
});

test("the first sufficient widened window remains fourteen days", async () => {
  const { requestedWindows, result } = await select(
    ["rank-1", "rank-2", "rank-3", "rank-4"],
    [
      candidate("rank-4", 20),
      candidate("rank-2", 8),
      candidate("rank-1", 2),
      candidate("rank-3", 13),
    ],
  );

  assert.deepEqual(requestedWindows, [30]);
  assert.deepEqual(result, {
    paperIds: ["rank-1", "rank-2", "rank-3"],
    windowDays: 14,
  });
});

test("sparse catalogs widen in memory while preserving ranking order", async () => {
  const { requestedWindows, result } = await select(
    ["rank-1", "rank-2", "rank-3", "rank-4", "outside"],
    [
      candidate("rank-4", 29),
      candidate("rank-2", 12),
      candidate("rank-1", 2),
      candidate("rank-3", 20),
    ],
  );

  assert.deepEqual(requestedWindows, [30]);
  assert.deepEqual(result, {
    paperIds: ["rank-1", "rank-2", "rank-3", "rank-4"],
    windowDays: 30,
  });
});

test("an undersized maximum window returns all available ranked papers", async () => {
  const { requestedWindows, result } = await select(
    ["rank-1", "outside", "rank-2"],
    [candidate("rank-2", 20), candidate("rank-1", 2)],
  );

  assert.deepEqual(requestedWindows, [30]);
  assert.deepEqual(result, {
    paperIds: ["rank-1", "rank-2"],
    windowDays: 30,
  });
});
