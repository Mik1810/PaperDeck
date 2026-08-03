import assert from "node:assert/strict";
import test from "node:test";
import {
  geminiGenerationConfig,
  parseSummaryJson,
  resolveGitHubModelsToken,
  summaryRunShouldFail,
} from "../../src/lib/summary-run";

test("Gemini requests use native structured output with minimal thinking", () => {
  const config = geminiGenerationConfig(2400);

  assert.equal(config.maxOutputTokens, 2400);
  assert.deepEqual(config.thinkingConfig, { thinkingLevel: "minimal" });
  assert.equal(config.responseFormat.text.mimeType, "APPLICATION_JSON");
  assert.deepEqual(config.responseFormat.text.schema.required, [
    "why_it_matters",
    "main_contribution",
    "prerequisites",
    "read_if_you_care_about",
  ]);
  assert.equal("temperature" in config, false);
});

test("summary JSON parsing never includes raw model output in errors", () => {
  assert.deepEqual(parseSummaryJson('{"value":"ok"}', "gemini"), {
    value: "ok",
  });
  assert.deepEqual(
    parseSummaryJson('prefix ```json\n{"value":"ok"}\n``` suffix', "gemini"),
    { value: "ok" },
  );

  assert.throws(
    () => parseSummaryJson("sensitive malformed output", "gemini"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "gemini did not return valid JSON");
      assert.doesNotMatch(error.message, /sensitive/);
      return true;
    },
  );
});

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
