export const INITIAL_FEED_RECOMMENDATION_COUNT = 50;
export const INITIAL_FEED_RECOMMENDATION_MODEL_VERSION =
  "paperdeck-initial-feed-v2";
export const LIVE_FEED_RECOMMENDATION_MODEL_VERSION = "paperdeck-live-feed-v1";
export const INITIAL_FEED_RECOMMENDATION_MAX_AGE_MS = 5 * 60 * 1000;

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
