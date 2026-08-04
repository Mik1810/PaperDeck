export type DeckSwipeDirection = "left" | "right";

const MIN_COMMIT_DISTANCE = 64;
const MAX_COMMIT_DISTANCE = 88;
const COMMIT_DISTANCE_VIEWPORT_RATIO = 0.18;
const COMMIT_VELOCITY = 350;
const MIN_FLICK_DISTANCE = 24;
const HORIZONTAL_INTENT_RATIO = 1.1;

export function deckSwipeCommitDistance(viewportWidth: number) {
  const safeViewportWidth =
    Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 390;

  return Math.min(
    MAX_COMMIT_DISTANCE,
    Math.max(
      MIN_COMMIT_DISTANCE,
      safeViewportWidth * COMMIT_DISTANCE_VIEWPORT_RATIO,
    ),
  );
}

export function resolveDeckSwipe({
  offsetX,
  offsetY,
  velocityX,
  viewportWidth,
}: {
  offsetX: number;
  offsetY: number;
  velocityX: number;
  viewportWidth: number;
}): DeckSwipeDirection | null {
  const horizontalDistance = Math.abs(offsetX);
  const verticalDistance = Math.abs(offsetY);
  const hasHorizontalIntent =
    horizontalDistance >= verticalDistance * HORIZONTAL_INTENT_RATIO;

  if (!hasHorizontalIntent) return null;

  const crossedDistance =
    horizontalDistance >= deckSwipeCommitDistance(viewportWidth);
  const crossedVelocity =
    horizontalDistance >= MIN_FLICK_DISTANCE &&
    Math.abs(velocityX) >= COMMIT_VELOCITY;

  if (!crossedDistance && !crossedVelocity) return null;
  return offsetX > 0 ? "right" : "left";
}
