import assert from "node:assert/strict";
import test from "node:test";
import {
  deckSwipeCommitDistance,
  resolveDeckSwipe,
} from "../../src/lib/client/deck-swipe";

test("deck swipe distance adapts to the viewport within safe bounds", () => {
  assert.equal(deckSwipeCommitDistance(320), 64);
  assert.equal(deckSwipeCommitDistance(400), 72);
  assert.equal(deckSwipeCommitDistance(1_000), 88);
  assert.equal(deckSwipeCommitDistance(Number.NaN), 70.2);
});

test("deck swipe commits deliberate horizontal movement in either direction", () => {
  assert.equal(
    resolveDeckSwipe({
      offsetX: 72,
      offsetY: 4,
      velocityX: 100,
      viewportWidth: 400,
    }),
    "right",
  );
  assert.equal(
    resolveDeckSwipe({
      offsetX: -72,
      offsetY: 4,
      velocityX: -100,
      viewportWidth: 400,
    }),
    "left",
  );
});

test("deck swipe accepts a short intentional flick but rejects a tiny one", () => {
  assert.equal(
    resolveDeckSwipe({
      offsetX: 30,
      offsetY: 2,
      velocityX: 360,
      viewportWidth: 400,
    }),
    "right",
  );
  assert.equal(
    resolveDeckSwipe({
      offsetX: 20,
      offsetY: 2,
      velocityX: 800,
      viewportWidth: 400,
    }),
    null,
  );
});

test("deck swipe rejects short and predominantly vertical gestures", () => {
  assert.equal(
    resolveDeckSwipe({
      offsetX: 60,
      offsetY: 2,
      velocityX: 120,
      viewportWidth: 400,
    }),
    null,
  );
  assert.equal(
    resolveDeckSwipe({
      offsetX: 90,
      offsetY: 85,
      velocityX: 700,
      viewportWidth: 400,
    }),
    null,
  );
});
