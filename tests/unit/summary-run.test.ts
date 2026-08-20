import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyProviderQuota,
  cloudflareGenerationConfig,
  cloudflareResultToText,
  geminiGenerationConfig,
  parseSummaryJson,
  resolveGitHubModelsToken,
  summaryRunShouldFail,
} from "../../src/lib/summary-run";

test("Cloudflare requests constrain reasoning and completion output", () => {
  const config = cloudflareGenerationConfig(4096);

  assert.equal(config.max_completion_tokens, 4096);
  assert.equal(config.reasoning_effort, "low");
  assert.equal("max_tokens" in config, false);
  assert.equal(config.response_format.type, "json_schema");
});

test("Cloudflare response parsing rejects reasoning-only completions", () => {
  assert.equal(
    cloudflareResultToText({
      choices: [{ message: { content: '{"value":"ok"}' } }],
    }),
    '{"value":"ok"}',
  );
  assert.equal(
    cloudflareResultToText({
      choices: [{ message: { content: null, reasoning: "private reasoning" } }],
    }),
    null,
  );
});

test("daily provider quotas stop the summary run instead of retrying", () => {
  assert.equal(
    classifyProviderQuota(
      "gemini",
      429,
      JSON.stringify({
        error: {
          details: [
            {
              violations: [
                {
                  quotaId:
                    "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
                },
              ],
            },
          ],
        },
      }),
    ),
    "terminal",
  );
  assert.equal(
    classifyProviderQuota(
      "cloudflare",
      429,
      JSON.stringify({
        errors: [
          {
            code: 3036,
            message: "You have used up your daily free allocation",
          },
        ],
      }),
    ),
    "terminal",
  );
});

test("temporary provider throttling remains retryable", () => {
  assert.equal(
    classifyProviderQuota(
      "gemini",
      429,
      JSON.stringify({
        error: {
          details: [
            {
              violations: [
                {
                  quotaId:
                    "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
                },
              ],
            },
          ],
        },
      }),
    ),
    "retryable",
  );
  assert.equal(
    classifyProviderQuota(
      "cloudflare",
      429,
      JSON.stringify({ errors: [{ code: 3040, message: "Out of capacity" }] }),
    ),
    "retryable",
  );
  assert.equal(classifyProviderQuota("gemini", 503, "overloaded"), "none");
});

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
