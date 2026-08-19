import assert from "node:assert/strict";
import test from "node:test";
import { logger } from "../../src/lib/logging/logger";

function captureErrorLog(run: () => void) {
  const lines: string[] = [];
  const originalError = console.error;
  console.error = (line?: unknown) => lines.push(String(line));

  try {
    run();
  } finally {
    console.error = originalError;
  }

  assert.equal(lines.length, 1);
  return {
    line: lines[0],
    payload: JSON.parse(lines[0]) as Record<string, unknown>,
  };
}

test("redacts stable deck activity identifiers and raw error details", () => {
  const ownerId = "user_owner_sentinel";
  const paperId = "paper-sentinel-222";
  const error = Object.assign(
    new Error(`failed for ${ownerId} and ${paperId}`),
    {
      code: "23505",
      detail: `provider metadata for ${ownerId}`,
    },
  );

  const { line, payload } = captureErrorLog(() => {
    logger.error("deck_action_failed", {
      ownerId,
      action: "favorite",
      paperId,
      error,
    });
  });

  assert.equal(payload.action, "favorite");
  assert.match(String(payload.eventId), /^[0-9a-f-]{36}$/i);
  assert.deepEqual(payload.error, { type: "Error", code: "23505" });
  assert.equal(line.includes(ownerId), false);
  assert.equal(line.includes(paperId), false);
  assert.equal(line.includes("provider metadata"), false);
  assert.equal(line.includes("stack"), false);
});

test("redacts impression identifiers, tokens, hashes, and unknown metadata", () => {
  const sentinels = [
    "user_impression_sentinel",
    "paper-impression-sentinel",
    "batch-item-sentinel",
    "invitation-token-sentinel",
    "email-hash-sentinel",
  ];

  const { line, payload } = captureErrorLog(() => {
    logger.error("recommendation_impression_record_failed", {
      ownerId: sentinels[0],
      paperId: sentinels[1],
      recommendationBatchItemId: sentinels[2],
      invitationToken: sentinels[3],
      emailHash: sentinels[4],
      providerMetadata: { detail: sentinels.join(":") },
      error: new Error(sentinels.join(":")),
    });
  });

  assert.equal(payload.event, "recommendation_impression_record_failed");
  for (const sentinel of sentinels) assert.equal(line.includes(sentinel), false);
  assert.deepEqual(payload.error, { type: "Error" });
});

test("preserves allowlisted operational diagnostics", () => {
  const { payload } = captureErrorLog(() => {
    logger.error("feed_generation_failed", {
      source: "live",
      durationMs: 125,
      outcome: "error",
      timings: { feed_state: 20, ranking: 105 },
      semantic: {
        used: true,
        candidateCount: 40,
        model: "all-MiniLM-L6-v2",
        paperId: "nested-paper-sentinel",
      },
      error: new TypeError("private provider detail"),
    });
  });

  assert.equal(payload.source, "live");
  assert.equal(payload.durationMs, 125);
  assert.deepEqual(payload.timings, { feed_state: 20, ranking: 105 });
  assert.deepEqual(payload.semantic, {
    used: true,
    candidateCount: 40,
    model: "all-MiniLM-L6-v2",
  });
  assert.deepEqual(payload.error, { type: "TypeError" });
});
