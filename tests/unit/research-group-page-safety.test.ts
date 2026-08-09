import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../../src/app/groups/page.tsx", import.meta.url),
  "utf8",
);

test("research-group index does not run profile bootstrap during rendering", () => {
  assert.match(pageSource, /requireOwnerId\(\)/);
  assert.doesNotMatch(pageSource, /ensureUserProfile/);
});

test("research-group cards do not prefetch expensive workspaces", () => {
  assert.match(pageSource, /prefetch=\{false\}/);
});
