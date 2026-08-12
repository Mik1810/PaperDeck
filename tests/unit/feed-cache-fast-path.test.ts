import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../src/lib/repositories/user-data.ts", import.meta.url),
  "utf8",
);

const batchLookupSource = source.slice(
  source.indexOf("async function getLatestRecommendationBatch"),
  source.indexOf("async function hydrateRecommendationBatch"),
);
const rankedFeedSource = source.slice(
  source.indexOf("async function getRankedFeedData"),
  source.indexOf("export async function getRankedFeedPapers"),
);

test("fresh cache lookup filters current hidden state in one database query", () => {
  assert.equal(batchLookupSource.match(/await db|return db/g)?.length, 1);
  assert.match(batchLookupSource, /select max\(latest\.generated_at\)/);
  assert.match(batchLookupSource, /from \$\{favorites\} as cached_favorite/);
  assert.match(batchLookupSource, /from \$\{playlistItems\} as cached_item/);
  assert.match(
    batchLookupSource,
    /from \$\{userPaperFeedExclusions\} as cached_exclusion/,
  );
  assert.doesNotMatch(batchLookupSource, /getFeedState|getTopics/);
});

test("taxonomy and full feed state load only after both cache paths miss", () => {
  const initialLookup = rankedFeedSource.indexOf(
    "getLatestInitialRecommendationBatch",
  );
  const liveLookup = rankedFeedSource.indexOf("getLatestLiveRecommendationBatch");
  const topics = rankedFeedSource.indexOf('measureAsync(timings, "topics"');
  const fullState = rankedFeedSource.indexOf('measureAsync(timings, "feed_state"');

  assert.ok(initialLookup >= 0);
  assert.ok(liveLookup > initialLookup);
  assert.ok(topics > liveLookup);
  assert.ok(fullState > liveLookup);
  assert.match(
    rankedFeedSource.slice(initialLookup, liveLookup),
    /hydrateRecommendationBatch/,
  );
  assert.match(
    rankedFeedSource.slice(initialLookup, liveLookup),
    /presentationState: null/,
  );
  assert.doesNotMatch(
    rankedFeedSource.slice(initialLookup, liveLookup),
    /getFeedState|getTopics|getSemanticPaperCandidates/,
  );
});

test("cached rows are hydrated only after the minimum batch size is met", () => {
  const sizeCheck = rankedFeedSource.indexOf(
    "isUsableRecommendationBatchSize(initialRows.length)",
  );
  const hydration = rankedFeedSource.indexOf(
    '"initial_batch_hydration"',
  );

  assert.ok(sizeCheck >= 0);
  assert.ok(hydration > sizeCheck);
  assert.doesNotMatch(
    rankedFeedSource.slice(sizeCheck, rankedFeedSource.indexOf("const liveRows")),
    /getFeedPresentationState/,
  );
});
