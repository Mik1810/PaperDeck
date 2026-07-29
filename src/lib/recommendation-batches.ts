export const INITIAL_FEED_RECOMMENDATION_COUNT = 50;
export const MIN_USABLE_RECOMMENDATION_BATCH_COUNT = 10;
export const INITIAL_FEED_RECOMMENDATION_MODEL_VERSION =
  "paperdeck-initial-feed-v2";
export const LIVE_FEED_RECOMMENDATION_MODEL_VERSION = "paperdeck-live-feed-v1";
export const INITIAL_FEED_RECOMMENDATION_MAX_AGE_MS = 5 * 60 * 1000;

export type RecommendationFeedSource =
  | "initial_batch"
  | "live_batch"
  | "live_rank";

export function recommendationModelVersionForFeedSource(
  source: RecommendationFeedSource,
) {
  return source === "initial_batch"
    ? INITIAL_FEED_RECOMMENDATION_MODEL_VERSION
    : LIVE_FEED_RECOMMENDATION_MODEL_VERSION;
}

export function isUsableRecommendationBatchSize(count: number) {
  return count >= MIN_USABLE_RECOMMENDATION_BATCH_COUNT;
}

export function needsCatalogRecommendationFill(
  count: number,
  targetCount = INITIAL_FEED_RECOMMENDATION_COUNT,
) {
  return count < targetCount;
}

export function isFreshRecommendationBatch(
  generatedAt: string,
  nowMs = Date.now(),
  maxAgeMs = INITIAL_FEED_RECOMMENDATION_MAX_AGE_MS,
) {
  const generatedAtMs = Date.parse(generatedAt);

  if (Number.isNaN(generatedAtMs)) {
    return false;
  }

  return nowMs - generatedAtMs <= maxAgeMs;
}
