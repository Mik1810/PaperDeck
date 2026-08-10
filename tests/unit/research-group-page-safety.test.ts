import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../../src/app/groups/page.tsx", import.meta.url),
  "utf8",
);
const detailPageSource = readFileSync(
  new URL("../../src/app/groups/[groupId]/page.tsx", import.meta.url),
  "utf8",
);
const workspaceRepositorySource = readFileSync(
  new URL(
    "../../src/lib/repositories/research-group-workspace.ts",
    import.meta.url,
  ),
  "utf8",
);

test("research-group index does not run profile bootstrap during rendering", () => {
  assert.match(pageSource, /requireOwnerId\(\)/);
  assert.doesNotMatch(pageSource, /ensureUserProfile/);
});

test("research-group cards do not prefetch expensive workspaces", () => {
  assert.match(pageSource, /prefetch=\{false\}/);
});

test("research-group detail uses one authorized workspace statement", () => {
  assert.match(detailPageSource, /loadResearchGroupWorkspace/);
  assert.doesNotMatch(detailPageSource, /Promise\.all/);
  assert.equal(workspaceRepositorySource.match(/db\.execute/g)?.length, 1);
  assert.match(
    workspaceRepositorySource,
    /with authorized_group as materialized/,
  );
  assert.match(workspaceRepositorySource, /from authorized_group/);
});
