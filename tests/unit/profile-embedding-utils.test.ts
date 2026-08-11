import assert from "node:assert/strict";
import test from "node:test";
import {
  addWeightedEmbeddingVector,
  buildProfilePaperWeights,
  createEmbeddingAccumulator,
  l2NormalizeEmbedding,
  parseEmbeddingVector,
  PROFILE_PAPER_INTERACTION_WEIGHTS,
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

test("current collection state, not append-only collection events, owns profile weight", () => {
  assert.equal(PROFILE_PAPER_INTERACTION_WEIGHTS.favorite, undefined);
  assert.equal(PROFILE_PAPER_INTERACTION_WEIGHTS.save_to_playlist, undefined);
});

test("profile collection weights deduplicate playlists and disappear after removal", () => {
  const saved = buildProfilePaperWeights({
    favoritePaperIds: [],
    playlistPaperIds: ["paper-a", "paper-a"],
    interactions: [
      { action: "save_to_playlist", paperId: "paper-a" },
      { action: "favorite", paperId: "paper-a" },
    ],
  });
  const removed = buildProfilePaperWeights({
    favoritePaperIds: [],
    playlistPaperIds: [],
    interactions: [
      { action: "save_to_playlist", paperId: "paper-a" },
      { action: "favorite", paperId: "paper-a" },
    ],
  });

  assert.equal(saved.get("paper-a"), 5);
  assert.equal(removed.has("paper-a"), false);
});
