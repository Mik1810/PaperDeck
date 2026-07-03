import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_FEED_RECOMMENDATION_COUNT,
  INITIAL_FEED_RECOMMENDATION_MODEL_VERSION,
  isFreshRecommendationBatch,
} from "../../src/lib/recommendation-batches";

test("initial feed batch constants are stable", () => {
  assert.equal(INITIAL_FEED_RECOMMENDATION_COUNT, 8);
  assert.equal(
    INITIAL_FEED_RECOMMENDATION_MODEL_VERSION,
    "paperdeck-initial-feed-v1",
  );
});

test("isFreshRecommendationBatch accepts recent batches", () => {
  const now = Date.parse("2026-07-03T12:00:00.000Z");

  assert.equal(
    isFreshRecommendationBatch("2026-07-03T11:45:00.000Z", now),
    true,
  );
});

test("isFreshRecommendationBatch rejects stale or invalid batches", () => {
  const now = Date.parse("2026-07-03T12:00:00.000Z");

  assert.equal(
    isFreshRecommendationBatch("2026-07-03T11:00:00.000Z", now),
    false,
  );
  assert.equal(isFreshRecommendationBatch("not-a-date", now), false);
});
