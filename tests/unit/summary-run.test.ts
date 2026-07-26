import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveGitHubModelsToken,
  summaryRunShouldFail,
} from "../../src/lib/summary-run";

test("GitHub Models token falls back to the automatic workflow token", () => {
  assert.equal(resolveGitHubModelsToken("", "automatic"), "automatic");
  assert.equal(resolveGitHubModelsToken(undefined, "automatic"), "automatic");
  assert.equal(resolveGitHubModelsToken("dedicated", "automatic"), "dedicated");
});

test("summary run fails only when every attempted summary failed", () => {
  assert.equal(summaryRunShouldFail(0, 1), true);
  assert.equal(summaryRunShouldFail(1, 1), false);
  assert.equal(summaryRunShouldFail(0, 0), false);
});
