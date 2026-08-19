import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  loadEligibleEnrichmentCandidates,
  processEnrichmentBatch,
  recordEnrichmentOutcome,
  isRetryableProviderStatus,
  olderThanEnrichmentPaperFilter,
  RetryableProviderError,
} from "./enrichment-outcomes";
import {
  S2BatchResponseSchema,
  S2CursorSchema,
  S2PaperRowArraySchema,
  type S2Paper,
  type S2PaperRow,
} from "../src/lib/schemas/s2-paper";
import { mapS2BatchResults } from "./semantic-scholar-batch";

type EnrichConfig = {
  batchSize: number;
  limit: number;
  dryRun: boolean;
  requestDelayMs: number;
  apiKey: string | null;
};

const S2_BASE = "https://api.semanticscholar.org/graph/v1";
const S2_FIELDS =
  "citationCount,year,venue,title,externalIds,url,publicationDate,openAccessPdf";

const CURSOR_KEY = "semantic_scholar_enrich";

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), ".env.local");

  if (!fs.existsSync(envPath)) {
    return;
  }

  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex);
    const value = line
      .slice(separatorIndex + 1)
      .replace(/^['"]|['"]$/g, "");

    process.env[key] ??= value;
  }
}

function parseArgs(): EnrichConfig {
  const args = process.argv.slice(2);
  const argValue = (name: string) => {
    const prefix = `--${name}=`;
    return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  };

  return {
    batchSize: Number(
      argValue("batch-size") ??
        process.env.S2_BATCH_SIZE ??
        100,
    ),
    limit: Number(argValue("limit") ?? process.env.S2_LIMIT ?? 500),
    dryRun: args.includes("--dry-run") || process.env.S2_DRY_RUN === "true",
    requestDelayMs: Number(
      process.env.S2_REQUEST_DELAY_MS ?? 1100,
    ),
    apiKey: process.env.SEMANTIC_SCHOLAR_API_KEY ?? null,
  };
}

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name}`);
  }

  return value;
}

function createSupabaseClient() {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

async function getPapersToEnrich(
  supabase: ReturnType<typeof createSupabaseClient>,
  limit: number,
) {
  return loadEligibleEnrichmentCandidates<S2PaperRow>({
    supabase,
    provider: "semantic_scholar",
    limit,
    paperId: (paper) => paper.id,
    fetchPage: async (after, pageSize) => {
      let query = supabase
        .from("papers")
        .select("id, arxiv_id, doi, venue, year, ingested_at")
        .eq("source", "arxiv")
        .is("semantic_scholar_id", null)
        .not("arxiv_id", "is", null)
        .order("ingested_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(pageSize);

      if (after) {
        query = query.or(olderThanEnrichmentPaperFilter(after));
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      return S2PaperRowArraySchema.parse(data ?? []);
    },
  });
}

async function fetchS2Batch(
  arxivIds: string[],
  apiKey: string | null,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  let response: Response;

  try {
    response = await fetch(
      `${S2_BASE}/paper/batch?fields=${S2_FIELDS}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          ids: arxivIds.map((id) => `ArXiv:${id}`),
        }),
      },
    );
  } catch {
    throw new RetryableProviderError();
  }

  if (isRetryableProviderStatus(response.status)) {
    throw new RetryableProviderError();
  }

  if (!response.ok) {
    throw new Error(
      `Semantic Scholar API error: ${response.status} ${response.statusText}`,
    );
  }

  try {
    return S2BatchResponseSchema.parse(await response.json());
  } catch {
    throw new RetryableProviderError();
  }
}

async function updatePaper(
  supabase: ReturnType<typeof createSupabaseClient>,
  paper: S2PaperRow,
  s2: S2Paper,
) {
  const updates: Record<string, unknown> = {
    semantic_scholar_id: s2.paperId,
    citation_count: s2.citationCount,
  };

  if (s2.venue && s2.venue !== paper.venue) {
    updates.venue = s2.venue;
  }

  if (s2.year && s2.year !== paper.year) {
    updates.year = s2.year;
  }

  if (s2.externalIds.DOI && !paper.doi) {
    updates.doi = s2.externalIds.DOI;
  }

  if (s2.openAccessPdf?.url) {
    updates.is_open_access = true;
  }

  const { error } = await supabase
    .from("papers")
    .update(updates)
    .eq("id", paper.id);

  if (error) {
    throw error;
  }

  const { error: externalIdError } = await supabase
    .from("paper_external_ids")
    .upsert(
      {
        paper_id: paper.id,
        provider: "semantic_scholar",
        external_id: s2.paperId,
        url: s2.url,
      },
      { onConflict: "paper_id,provider,external_id" },
    );

  if (externalIdError) {
    throw externalIdError;
  }

  if (s2.externalIds.DOI) {
    const { error: doiError } = await supabase
      .from("paper_external_ids")
      .upsert(
        {
          paper_id: paper.id,
          provider: "doi",
          external_id: s2.externalIds.DOI,
          url: `https://doi.org/${s2.externalIds.DOI}`,
        },
        { onConflict: "paper_id,provider,external_id" },
      );

    if (doiError) {
      throw doiError;
    }
  }
}

async function getCursor(
  supabase: ReturnType<typeof createSupabaseClient>,
) {
  const { data, error } = await supabase
    .from("ingestion_cursors")
    .select("cursor_value, imported_count")
    .eq("source", "arxiv")
    .eq("cursor_key", CURSOR_KEY)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return S2CursorSchema.parse(data);
}

async function updateCursor(
  supabase: ReturnType<typeof createSupabaseClient>,
  totalEnriched: number,
  lastPaperId: string,
) {
  const { error } = await supabase.from("ingestion_cursors").upsert(
    {
      source: "arxiv",
      cursor_key: CURSOR_KEY,
      cursor_value: lastPaperId,
      imported_count: totalEnriched,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "source,cursor_key" },
  );

  if (error) {
    throw error;
  }
}

async function main() {
  loadLocalEnv();
  const config = parseArgs();

  console.error(
    `Enriching up to ${config.limit} papers (batch size ${config.batchSize}, dry-run: ${config.dryRun})`,
  );

  const supabase = createSupabaseClient();
  const candidates = await getPapersToEnrich(supabase, config.limit);

  if (!candidates.length) {
    console.error("No papers found needing enrichment");
    return;
  }

  console.error(`Found ${candidates.length} eligible papers to enrich`);

  const cursor = await getCursor(supabase);
  let totalEnriched = cursor?.imported_count ?? 0;
  let totalFound = 0;
  let totalNotFound = 0;
  let totalRetryableErrors = 0;
  let providerLookups = 0;
  let providerRequests = 0;

  for (let i = 0; i < candidates.length; i += config.batchSize) {
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.requestDelayMs));
    }

    const batch = candidates.slice(i, i + config.batchSize);

    console.error(
      `Batch ${Math.floor(i / config.batchSize) + 1}: ${batch.length} papers`,
    );

    const batchSummary = await processEnrichmentBatch<S2PaperRow, S2Paper>({
      candidates: batch,
      dryRun: config.dryRun,
      paperId: (paper) => paper.id,
      lookup: async (papers) => {
        const results = await fetchS2Batch(
          papers.map((paper) => paper.arxiv_id),
          config.apiKey,
        );
        return mapS2BatchResults(papers, results);
      },
      applyFound: (paper, s2) => updatePaper(supabase, paper, s2),
      persistOutcome: (candidate, outcome) =>
        recordEnrichmentOutcome({
          supabase,
          provider: "semantic_scholar",
          paperId: candidate.paper.id,
          outcome,
          previousAttemptCount: candidate.previousAttemptCount,
        }),
    });

    totalFound += batchSummary.found;
    totalNotFound += batchSummary.notFound;
    totalRetryableErrors += batchSummary.retryableErrors;
    providerLookups += batchSummary.providerLookups;
    providerRequests += batchSummary.providerRequests;

    if (batchSummary.retryableErrors) {
      console.error(
        `Batch deferred after a retryable provider failure: ${batchSummary.retryableErrors} papers`,
      );
    }

    if (!config.dryRun) {
      totalEnriched += batchSummary.found;

      if (batch.length > 0) {
        const lastPaper = batch[batch.length - 1];
        await updateCursor(supabase, totalEnriched, lastPaper.paper.id);
      }
    }
  }

  const summary = {
    mode: config.dryRun ? "dry-run" : "write",
    papersChecked: candidates.length,
    enriched: totalFound,
    notFound: totalNotFound,
    retryableErrors: totalRetryableErrors,
    providerLookups,
    providerRequests,
    lookupsPerTerminalOutcome:
      totalFound + totalNotFound > 0
        ? providerLookups / (totalFound + totalNotFound)
        : null,
    totalEnriched,
  };

  console.log(JSON.stringify(summary));
}

void main();
