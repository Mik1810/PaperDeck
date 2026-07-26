import assert from "node:assert/strict";
import test from "node:test";
import { arxivRetryDelayMs } from "../../src/lib/arxiv-retry";

test("arXiv rate-limit retries back off for one, two, then four minutes", () => {
  assert.equal(arxivRetryDelayMs(429, 0, null, 0.5), 60_000);
  assert.equal(arxivRetryDelayMs(429, 1, null, 0.5), 120_000);
  assert.equal(arxivRetryDelayMs(429, 2, null, 0.5), 240_000);
});

test("arXiv upstream retries remain shorter than rate-limit retries", () => {
  assert.equal(arxivRetryDelayMs(503, 0, null, 0.5), 5_000);
  assert.equal(arxivRetryDelayMs(503, 1, null, 0.5), 10_000);
  assert.equal(arxivRetryDelayMs(503, 2, null, 0.5), 20_000);
});

test("arXiv retries honor Retry-After seconds", () => {
  assert.equal(arxivRetryDelayMs(429, 0, "90", 0.5), 90_000);
});

test("arXiv retries honor Retry-After HTTP dates", () => {
  const nowMs = Date.parse("2026-07-27T00:00:00Z");

  assert.equal(
    arxivRetryDelayMs(
      429,
      0,
      "Mon, 27 Jul 2026 00:02:00 GMT",
      0.5,
      nowMs,
    ),
    120_000,
  );
});
