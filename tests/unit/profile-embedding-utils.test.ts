import assert from "node:assert/strict";
import test from "node:test";
import {
  addWeightedEmbeddingVector,
  createEmbeddingAccumulator,
  l2NormalizeEmbedding,
  parseEmbeddingVector,
  PROFILE_PAPER_INTERACTION_WEIGHTS,
  topicSelectionInputSignature,
} from "../../src/lib/profile-embedding-utils";

test("parseEmbeddingVector accepts pgvector literals and arrays", () => {
  assert.deepEqual(parseEmbeddingVector("[1,2,3]", 3), [1, 2, 3]);
  assert.deepEqual(parseEmbeddingVector([4, 5, 6], 3), [4, 5, 6]);
});

test("parseEmbeddingVector rejects unexpected dimensions", () => {
  assert.throws(
    () => parseEmbeddingVector("[1,2]", 3),
    /Expected 3 embedding dimensions/,
  );
});

test("l2NormalizeEmbedding normalizes non-zero vectors", () => {
  assert.deepEqual(l2NormalizeEmbedding([3, 4]), [0.6, 0.8]);
  assert.equal(l2NormalizeEmbedding([0, 0]), null);
});

test("addWeightedEmbeddingVector applies weights in place", () => {
  const accumulator = createEmbeddingAccumulator(3);

  addWeightedEmbeddingVector(accumulator, [1, 2, 3], 4);
  addWeightedEmbeddingVector(accumulator, [1, 1, 1], -1);

  assert.deepEqual(accumulator, [3, 7, 11]);
});

test("already_read has the same positive profile weight as read", () => {
  assert.equal(
    PROFILE_PAPER_INTERACTION_WEIGHTS.already_read,
    PROFILE_PAPER_INTERACTION_WEIGHTS.read,
  );
  assert.equal(PROFILE_PAPER_INTERACTION_WEIGHTS.already_read, 3);
});

test("topicSelectionInputSignature is order-insensitive and not hashed", () => {
  const embeddedAtByTopicId = new Map([
    ["topic-a", "2026-07-03T10:00:00.000Z"],
    ["topic-b", "2026-07-03T11:00:00.000Z"],
  ]);
  const first = topicSelectionInputSignature("model", [
    "topic-b",
    "topic-a",
  ], embeddedAtByTopicId);
  const second = topicSelectionInputSignature("model", [
    "topic-a",
    "topic-b",
  ], embeddedAtByTopicId);

  assert.equal(first, second);
  assert.match(first, /^topic-selection:model:/);
  assert.match(first, /topic-a:2026-07-03T10:00:00.000Z/);
  assert.match(first, /topic-b:2026-07-03T11:00:00.000Z/);
});
