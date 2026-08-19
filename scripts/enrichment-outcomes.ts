import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const ENRICHMENT_PROVIDERS = [
  "semantic_scholar",
  "openalex",
  "unpaywall",
] as const;

export const ENRICHMENT_OUTCOMES = [
  "found",
  "not_found",
  "not_oa",
  "retryable_error",
] as const;

export type EnrichmentProvider = (typeof ENRICHMENT_PROVIDERS)[number];
export type EnrichmentOutcome = (typeof ENRICHMENT_OUTCOMES)[number];

type EnrichmentOutcomeRecord = {
  provider: EnrichmentProvider;
  paper_id: string;
  outcome: EnrichmentOutcome;
  attempt_count: number;
  last_checked_at: string;
  next_eligible_at: string | null;
};

type EnrichmentDatabase = {
  public: {
    Tables: {
      paper_enrichment_outcomes: {
        Row: EnrichmentOutcomeRecord;
        Insert: EnrichmentOutcomeRecord;
        Update: Partial<EnrichmentOutcomeRecord>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

type WorkerSupabaseClient = SupabaseClient<EnrichmentDatabase>;

const OutcomeRowArraySchema = z.array(
  z.object({
    paper_id: z.string().uuid(),
    outcome: z.enum(ENRICHMENT_OUTCOMES),
    attempt_count: z.number().int().positive(),
    next_eligible_at: z.string().nullable(),
  }),
);

export type PersistedOutcome = z.infer<typeof OutcomeRowArraySchema>[number];

const FIRST_RETRY_DELAY_MS = 60 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 100;

type OrderedEnrichmentPaper = {
  id: string;
  ingested_at: string;
};

export type EligibleEnrichmentCandidate<T> = {
  paper: T;
  previousAttemptCount: number;
};

export type ProviderDecision<T> =
  | { outcome: "found"; value: T }
  | { outcome: "not_found" | "not_oa" };

export type ProcessedBatch = {
  found: number;
  notFound: number;
  notOa: number;
  retryableErrors: number;
  providerLookups: number;
  providerRequests: number;
};

export class RetryableProviderError extends Error {
  constructor() {
    super("Retryable provider failure");
    this.name = "RetryableProviderError";
  }
}

export function isRetryableProviderStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function retryDelayMs(attemptCount: number) {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 10));
  return Math.min(FIRST_RETRY_DELAY_MS * 2 ** exponent, MAX_RETRY_DELAY_MS);
}

export function retryEligibleAt(attemptCount: number, checkedAt: Date) {
  return new Date(checkedAt.getTime() + retryDelayMs(attemptCount));
}

export function olderThanEnrichmentPaperFilter(paper: OrderedEnrichmentPaper) {
  return `ingested_at.lt.${paper.ingested_at},and(ingested_at.eq.${paper.ingested_at},id.lt.${paper.id})`;
}

export function selectEligibleEnrichmentCandidates<T>({
  papers,
  outcomes,
  limit,
  paperId,
  now,
}: {
  papers: T[];
  outcomes: PersistedOutcome[];
  limit: number;
  paperId: (paper: T) => string;
  now: Date;
}) {
  const outcomesByPaper = new Map(
    outcomes.map((outcome) => [outcome.paper_id, outcome]),
  );
  const candidates: EligibleEnrichmentCandidate<T>[] = [];

  for (const paper of papers) {
    const outcome = outcomesByPaper.get(paperId(paper));
    const eligible =
      !outcome ||
      (outcome.outcome === "retryable_error" &&
        outcome.next_eligible_at !== null &&
        new Date(outcome.next_eligible_at) <= now);

    if (eligible) {
      candidates.push({
        paper,
        previousAttemptCount: outcome?.attempt_count ?? 0,
      });
    }

    if (candidates.length === limit) {
      break;
    }
  }

  return candidates;
}

export async function loadEligibleEnrichmentCandidates<
  T extends OrderedEnrichmentPaper,
>({
  supabase,
  provider,
  limit,
  fetchPage,
  excludePaperIds,
  paperId,
  now = new Date(),
  pageSize = DEFAULT_PAGE_SIZE,
}: {
  supabase: WorkerSupabaseClient;
  provider: EnrichmentProvider;
  limit: number;
  fetchPage: (after: T | null, pageSize: number) => Promise<T[]>;
  excludePaperIds?: (papers: T[]) => Promise<Set<string>>;
  paperId: (paper: T) => string;
  now?: Date;
  pageSize?: number;
}) {
  const candidates: EligibleEnrichmentCandidate<T>[] = [];
  let after: T | null = null;

  while (candidates.length < limit) {
    const papers = await fetchPage(after, pageSize);

    if (!papers.length) {
      break;
    }

    const excludedIds = excludePaperIds
      ? await excludePaperIds(papers)
      : new Set<string>();
    const selectablePapers = papers.filter(
      (paper) => !excludedIds.has(paperId(paper)),
    );
    const selectableIds = selectablePapers.map(paperId);
    let outcomeRows: PersistedOutcome[] = [];

    if (selectableIds.length) {
      const { data, error } = await supabase
        .from("paper_enrichment_outcomes")
        .select("paper_id, outcome, attempt_count, next_eligible_at")
        .eq("provider", provider)
        .in("paper_id", selectableIds);

      if (error) {
        throw error;
      }

      outcomeRows = OutcomeRowArraySchema.parse(data ?? []);
    }

    candidates.push(
      ...selectEligibleEnrichmentCandidates({
        papers: selectablePapers,
        outcomes: outcomeRows,
        limit: limit - candidates.length,
        paperId,
        now,
      }),
    );

    if (papers.length < pageSize) {
      break;
    }

    after = papers[papers.length - 1];
  }

  return candidates;
}

export async function recordEnrichmentOutcome({
  supabase,
  provider,
  paperId,
  outcome,
  previousAttemptCount,
  checkedAt = new Date(),
}: {
  supabase: WorkerSupabaseClient;
  provider: EnrichmentProvider;
  paperId: string;
  outcome: EnrichmentOutcome;
  previousAttemptCount: number;
  checkedAt?: Date;
}) {
  const attemptCount = previousAttemptCount + 1;
  const { error } = await supabase.from("paper_enrichment_outcomes").upsert(
    {
      provider,
      paper_id: paperId,
      outcome,
      attempt_count: attemptCount,
      last_checked_at: checkedAt.toISOString(),
      next_eligible_at:
        outcome === "retryable_error"
          ? retryEligibleAt(attemptCount, checkedAt).toISOString()
          : null,
    },
    { onConflict: "provider,paper_id" },
  );

  if (error) {
    throw error;
  }
}

export async function processEnrichmentBatch<TPaper, TResult>({
  candidates,
  dryRun,
  lookup,
  paperId,
  applyFound,
  persistOutcome,
}: {
  candidates: EligibleEnrichmentCandidate<TPaper>[];
  dryRun: boolean;
  lookup: (papers: TPaper[]) => Promise<Map<string, ProviderDecision<TResult>>>;
  paperId: (paper: TPaper) => string;
  applyFound: (paper: TPaper, result: TResult) => Promise<void>;
  persistOutcome: (
    candidate: EligibleEnrichmentCandidate<TPaper>,
    outcome: EnrichmentOutcome,
  ) => Promise<void>;
}): Promise<ProcessedBatch> {
  const summary: ProcessedBatch = {
    found: 0,
    notFound: 0,
    notOa: 0,
    retryableErrors: 0,
    providerLookups: candidates.length,
    providerRequests: candidates.length ? 1 : 0,
  };

  let decisions: Map<string, ProviderDecision<TResult>>;

  try {
    decisions = await lookup(candidates.map(({ paper }) => paper));
  } catch (error) {
    if (!(error instanceof RetryableProviderError)) {
      throw error;
    }

    summary.retryableErrors = candidates.length;

    if (!dryRun) {
      for (const candidate of candidates) {
        await persistOutcome(candidate, "retryable_error");
      }
    }

    return summary;
  }

  for (const candidate of candidates) {
    const decision = decisions.get(paperId(candidate.paper));

    if (!decision) {
      summary.retryableErrors++;
      if (!dryRun) {
        await persistOutcome(candidate, "retryable_error");
      }
      continue;
    }

    if (decision.outcome === "found") {
      summary.found++;
      if (!dryRun) {
        await applyFound(candidate.paper, decision.value);
        await persistOutcome(candidate, "found");
      }
      continue;
    }

    if (decision.outcome === "not_oa") {
      summary.notOa++;
    } else {
      summary.notFound++;
    }

    if (!dryRun) {
      await persistOutcome(candidate, decision.outcome);
    }
  }

  return summary;
}
