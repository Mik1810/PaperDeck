import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ENRICHMENT_PROVIDERS,
  RetryableProviderError,
  isRetryableProviderStatus,
  olderThanEnrichmentPaperFilter,
  processEnrichmentBatch,
  retryDelayMs,
  retryEligibleAt,
  selectEligibleEnrichmentCandidates,
  type EnrichmentOutcome,
  type PersistedOutcome,
  type ProviderDecision,
} from "../../scripts/enrichment-outcomes";

type FakePaper = { id: string };
type FakeResult = { externalId: string };

const checkedAt = new Date("2026-08-20T10:00:00.000Z");

function persisted(
  paperId: string,
  outcome: EnrichmentOutcome,
  attemptCount = 1,
  nextEligibleAt: Date | null = null,
): PersistedOutcome {
  return {
    paper_id: paperId,
    outcome,
    attempt_count: attemptCount,
    next_eligible_at: nextEligibleAt?.toISOString() ?? null,
  };
}

test("retryable outcomes use bounded exponential backoff", () => {
  assert.equal(retryDelayMs(1), 60 * 60 * 1000);
  assert.equal(retryDelayMs(2), 2 * 60 * 60 * 1000);
  assert.equal(retryDelayMs(20), 24 * 60 * 60 * 1000);
  assert.equal(
    retryEligibleAt(2, checkedAt).toISOString(),
    "2026-08-20T12:00:00.000Z",
  );
});

test("only transient HTTP statuses are classified for retry", () => {
  assert.equal(isRetryableProviderStatus(408), true);
  assert.equal(isRetryableProviderStatus(429), true);
  assert.equal(isRetryableProviderStatus(503), true);
  assert.equal(isRetryableProviderStatus(400), false);
  assert.equal(isRetryableProviderStatus(401), false);
  assert.equal(isRetryableProviderStatus(404), false);
});

test("candidate pagination uses the complete descending keyset", () => {
  assert.equal(
    olderThanEnrichmentPaperFilter({
      id: "00000000-0000-4000-8000-000000000001",
      ingested_at: "2026-08-20T10:00:00.000Z",
    }),
    "ingested_at.lt.2026-08-20T10:00:00.000Z,and(ingested_at.eq.2026-08-20T10:00:00.000Z,id.lt.00000000-0000-4000-8000-000000000001)",
  );
});

for (const provider of ENRICHMENT_PROVIDERS) {
  test(`${provider} reaches first-time candidates beyond a permanent-miss prefix`, async () => {
    const papers = ["miss-1", "miss-2", "found-3", "found-4"].map((id) => ({ id }));
    let outcomes: PersistedOutcome[] = [];
    const applied: string[] = [];

    const run = async () => {
      const candidates = selectEligibleEnrichmentCandidates({
        papers,
        outcomes,
        limit: 2,
        paperId: (paper) => paper.id,
        now: checkedAt,
      });
      const decisions = new Map<string, ProviderDecision<FakeResult>>(
        candidates.map(({ paper }) => [
          paper.id,
          paper.id.startsWith("miss")
            ? { outcome: "not_found" }
            : { outcome: "found", value: { externalId: `provider:${paper.id}` } },
        ]),
      );
      const summary = await processEnrichmentBatch<FakePaper, FakeResult>({
        candidates,
        dryRun: false,
        paperId: (paper) => paper.id,
        lookup: async () => decisions,
        applyFound: async (paper) => {
          applied.push(paper.id);
        },
        persistOutcome: async (candidate, outcome) => {
          outcomes = outcomes.filter(
            (existing) => existing.paper_id !== candidate.paper.id,
          );
          outcomes.push(
            persisted(
              candidate.paper.id,
              outcome,
              candidate.previousAttemptCount + 1,
            ),
          );
        },
      });
      return { candidates, summary };
    };

    const first = await run();
    assert.deepEqual(
      first.candidates.map(({ paper }) => paper.id),
      ["miss-1", "miss-2"],
    );
    assert.equal(first.summary.notFound, 2);
    assert.equal(first.summary.providerLookups, 2);

    const second = await run();
    assert.deepEqual(
      second.candidates.map(({ paper }) => paper.id),
      ["found-3", "found-4"],
    );
    assert.equal(second.summary.found, 2);
    assert.equal(second.summary.providerLookups, 2);
    assert.deepEqual(applied, ["found-3", "found-4"]);

    const third = await run();
    assert.equal(third.candidates.length, 0);
    assert.equal(third.summary.providerRequests, 0);
  });
}

test("retryable provider failure becomes eligible only after its backoff", async () => {
  const paper = { id: "retry-me" };
  let recorded: PersistedOutcome | undefined;
  const candidates = [{ paper, previousAttemptCount: 0 }];

  const summary = await processEnrichmentBatch<FakePaper, FakeResult>({
    candidates,
    dryRun: false,
    paperId: (candidate) => candidate.id,
    lookup: async () => {
      throw new RetryableProviderError();
    },
    applyFound: async () => {
      assert.fail("retryable failures must not apply a positive result");
    },
    persistOutcome: async (candidate, outcome) => {
      const attemptCount = candidate.previousAttemptCount + 1;
      recorded = persisted(
        candidate.paper.id,
        outcome,
        attemptCount,
        retryEligibleAt(attemptCount, checkedAt),
      );
    },
  });

  assert.equal(summary.retryableErrors, 1);
  assert.equal(recorded?.outcome, "retryable_error");
  assert.equal(
    selectEligibleEnrichmentCandidates({
      papers: [paper],
      outcomes: [recorded!],
      limit: 1,
      paperId: (candidate) => candidate.id,
      now: new Date("2026-08-20T10:59:59.999Z"),
    }).length,
    0,
  );
  assert.equal(
    selectEligibleEnrichmentCandidates({
      papers: [paper],
      outcomes: [recorded!],
      limit: 1,
      paperId: (candidate) => candidate.id,
      now: new Date("2026-08-20T11:00:00.000Z"),
    }).length,
    1,
  );
});

test("non-retryable provider failures still fail the worker", async () => {
  await assert.rejects(
    processEnrichmentBatch<FakePaper, FakeResult>({
      candidates: [{ paper: { id: "bad-request" }, previousAttemptCount: 0 }],
      dryRun: false,
      paperId: (paper) => paper.id,
      lookup: async () => {
        throw new Error("provider rejected the request");
      },
      applyFound: async () => undefined,
      persistOutcome: async () => undefined,
    }),
    /provider rejected the request/,
  );
});

test("non-OA is terminal and dry-run does not persist outcomes", async () => {
  let writes = 0;
  const summary = await processEnrichmentBatch<FakePaper, FakeResult>({
    candidates: [{ paper: { id: "closed" }, previousAttemptCount: 0 }],
    dryRun: true,
    paperId: (paper) => paper.id,
    lookup: async () =>
      new Map([["closed", { outcome: "not_oa" as const }]]),
    applyFound: async () => {
      writes++;
    },
    persistOutcome: async () => {
      writes++;
    },
  });

  assert.equal(summary.notOa, 1);
  assert.equal(writes, 0);
});
