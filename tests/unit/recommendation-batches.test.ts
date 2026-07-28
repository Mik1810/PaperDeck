import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_FEED_RECOMMENDATION_COUNT,
  INITIAL_FEED_RECOMMENDATION_MODEL_VERSION,
  MIN_USABLE_RECOMMENDATION_BATCH_COUNT,
  isFreshRecommendationBatch,
  isUsableRecommendationBatchSize,
  needsCatalogRecommendationFill,
} from "../../src/lib/recommendation-batches";

test("initial feed batch constants are stable", () => {
  assert.equal(INITIAL_FEED_RECOMMENDATION_COUNT, 50);
  assert.equal(MIN_USABLE_RECOMMENDATION_BATCH_COUNT, 10);
  assert.equal(
    INITIAL_FEED_RECOMMENDATION_MODEL_VERSION,
    "paperdeck-initial-feed-v2",
  );
});

test("recommendation batches below the visible floor are regenerated", () => {
  assert.equal(isUsableRecommendationBatchSize(9), false);
  assert.equal(isUsableRecommendationBatchSize(10), true);
});

test("semantic candidate shortages trigger catalog fill", () => {
  assert.equal(needsCatalogRecommendationFill(49), true);
  assert.equal(needsCatalogRecommendationFill(50), false);
});

test("isFreshRecommendationBatch accepts recent batches", () => {
  const now = Date.parse("2026-07-03T12:00:00.000Z");

  assert.equal(
    isFreshRecommendationBatch("2026-07-03T11:57:00.000Z", now),
    true,
  );
});

test("isFreshRecommendationBatch rejects stale or invalid batches", () => {
  const now = Date.parse("2026-07-03T12:00:00.000Z");

  assert.equal(
    isFreshRecommendationBatch("2026-07-03T11:45:00.000Z", now),
    false,
  );
  assert.equal(isFreshRecommendationBatch("not-a-date", now), false);
});
