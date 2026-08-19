import assert from "node:assert/strict";
import { test } from "node:test";
import {
  processEnrichmentBatch,
  RetryableProviderError,
  selectEligibleEnrichmentCandidates,
  type EnrichmentOutcome,
} from "../../scripts/enrichment-outcomes";
import { mapS2BatchResults } from "../../scripts/semantic-scholar-batch";
import { fetchUnpaywall } from "../../scripts/unpaywall-client";
import { S2BatchResponseSchema } from "../../src/lib/schemas/s2-paper";

const s2Papers = [
  { id: "paper-with-null-status" },
  { id: "paper-not-found" },
  { id: "paper-with-status" },
];

test("Semantic Scholar accepts null OA status and preserves mixed batch outcomes", async () => {
  const results = S2BatchResponseSchema.parse([
    {
      paperId: "s2-null-status",
      externalIds: { ArXiv: "2401.00001" },
      citationCount: 4,
      year: 2024,
      venue: "",
      title: "Null OA status",
      url: "https://www.semanticscholar.org/paper/s2-null-status",
      publicationDate: "2024-01-01",
      openAccessPdf: {
        url: "https://example.test/null-status.pdf",
        status: null,
      },
    },
    null,
    {
      paperId: "s2-with-status",
      externalIds: { ArXiv: "2401.00003" },
      citationCount: 2,
      year: 2024,
      venue: "TestConf",
      title: "String OA status",
      url: "https://www.semanticscholar.org/paper/s2-with-status",
      publicationDate: null,
      openAccessPdf: {
        url: "https://example.test/with-status.pdf",
        status: "GREEN",
      },
    },
  ]);
  const persisted = new Map<string, EnrichmentOutcome>();
  const applied: string[] = [];

  const summary = await processEnrichmentBatch({
    candidates: s2Papers.map((paper) => ({
      paper,
      previousAttemptCount: 0,
    })),
    dryRun: false,
    paperId: (paper) => paper.id,
    lookup: async (papers) => mapS2BatchResults(papers, results),
    applyFound: async (paper, result) => {
      applied.push(paper.id);
      if (paper.id === "paper-with-null-status") {
        assert.equal(result.openAccessPdf?.status, null);
      }
    },
    persistOutcome: async (candidate, outcome) => {
      persisted.set(candidate.paper.id, outcome);
    },
  });

  assert.deepEqual(summary, {
    found: 2,
    notFound: 1,
    notOa: 0,
    retryableErrors: 0,
    providerLookups: 3,
    providerRequests: 1,
  });
  assert.deepEqual(applied, ["paper-with-null-status", "paper-with-status"]);
  assert.deepEqual([...persisted], [
    ["paper-with-null-status", "found"],
    ["paper-not-found", "not_found"],
    ["paper-with-status", "found"],
  ]);
});

test("Unpaywall timeout persists a retryable_error outcome", async () => {
  const fetchImpl: typeof fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(init.signal?.reason),
        { once: true },
      );
    });
  let persisted: EnrichmentOutcome | undefined;

  const summary = await processEnrichmentBatch({
    candidates: [
      {
        paper: { id: "timeout", doi: "10.1000/timeout" },
        previousAttemptCount: 0,
      },
    ],
    dryRun: false,
    paperId: (paper) => paper.id,
    lookup: async ([paper]) => {
      await fetchUnpaywall({
        doi: paper.doi,
        email: "test@example.test",
        timeoutMs: 5,
        fetchImpl,
      });
      return new Map();
    },
    applyFound: async () => assert.fail("a timed-out lookup cannot be applied"),
    persistOutcome: async (_candidate, outcome) => {
      persisted = outcome;
    },
  });

  assert.equal(summary.retryableErrors, 1);
  assert.equal(persisted, "retryable_error");
});

test("Unpaywall caller abort is classified as a retryable provider failure", async () => {
  const controller = new AbortController();
  const fetchImpl: typeof fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(init.signal?.reason),
        { once: true },
      );
    });
  const request = fetchUnpaywall({
    doi: "10.1000/abort",
    email: "test@example.test",
    timeoutMs: 10_000,
    signal: controller.signal,
    fetchImpl,
  });

  controller.abort();

  await assert.rejects(request, RetryableProviderError);
});

test("completed enrichment outcomes are not selected again", () => {
  const papers = ["found", "not-found", "not-oa", "new"].map((id) => ({ id }));
  const outcomes = [
    {
      paper_id: "found",
      outcome: "found" as const,
      attempt_count: 1,
      next_eligible_at: null,
    },
    {
      paper_id: "not-found",
      outcome: "not_found" as const,
      attempt_count: 1,
      next_eligible_at: null,
    },
    {
      paper_id: "not-oa",
      outcome: "not_oa" as const,
      attempt_count: 1,
      next_eligible_at: null,
    },
  ];

  assert.deepEqual(
    selectEligibleEnrichmentCandidates({
      papers,
      outcomes,
      limit: 4,
      paperId: (paper) => paper.id,
      now: new Date("2026-08-20T12:00:00.000Z"),
    }).map(({ paper }) => paper.id),
    ["new"],
  );
});
