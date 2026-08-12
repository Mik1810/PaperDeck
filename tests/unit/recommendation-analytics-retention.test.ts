import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parsePositiveInteger } from "../../scripts/lib/recommendation-analytics-retention";

const retentionSource = readFileSync(
  new URL(
    "../../scripts/lib/recommendation-analytics-retention.ts",
    import.meta.url,
  ),
  "utf8",
);
const migrationSource = readFileSync(
  new URL(
    "../../supabase/migrations/20260812210000_batch_recommendation_impression_retention.sql",
    import.meta.url,
  ),
  "utf8",
);

test("recommendation retention accepts only bounded positive integers", () => {
  assert.equal(parsePositiveInteger("1", "Batch size", 10_000), 1);
  assert.equal(parsePositiveInteger("10000", "Batch size", 10_000), 10_000);
  assert.throws(() => parsePositiveInteger("0", "Batch size", 10_000));
  assert.throws(() => parsePositiveInteger("10001", "Batch size", 10_000));
  assert.throws(() => parsePositiveInteger("1.5", "Batch size", 10_000));
});

test("recommendation retention uses ordered skip-locked batches without returning rows", () => {
  assert.match(retentionSource, /order by impression\.shown_at, impression\.id/);
  assert.match(retentionSource, /order by batch_item\.delivered_at, batch_item\.id/);
  assert.equal(retentionSource.match(/for update skip locked/g)?.length, 2);
  assert.doesNotMatch(retentionSource, /\breturning\b/i);
  assert.doesNotMatch(retentionSource, /sql\.begin/);
});

test("recommendation retention indexes match both global expiry keysets", () => {
  assert.match(
    migrationSource,
    /recommendation_impressions\(shown_at, id\)/,
  );
  assert.match(
    migrationSource,
    /recommendation_batch_items\(delivered_at, id\)/,
  );
});
