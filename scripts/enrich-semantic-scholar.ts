import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

type EnrichConfig = {
  batchSize: number;
  limit: number;
  dryRun: boolean;
  requestDelayMs: number;
  apiKey: string | null;
};

type PaperRow = {
  id: string;
  arxiv_id: string;
  doi: string | null;
  venue: string | null;
  year: number | null;
  ingested_at: string;
};

type S2ExternalIds = {
  ArXiv?: string;
  DOI?: string;
  MAG?: string;
  CorpusId?: number;
};

type S2OpenAccessPdf = {
  url: string;
  status: string;
};

type S2Paper = {
  paperId: string;
  externalIds: S2ExternalIds;
  citationCount: number;
  year: number | null;
  venue: string;
  title: string;
  url: string;
  publicationDate: string | null;
  openAccessPdf: S2OpenAccessPdf | null;
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
  const { data, error } = await supabase
    .from("papers")
    .select("id, arxiv_id, doi, venue, year, ingested_at")
    .eq("source", "arxiv")
    .is("semantic_scholar_id", null)
    .not("arxiv_id", "is", null)
    .order("ingested_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data ?? []) as PaperRow[];
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

  const response = await fetch(
    `${S2_BASE}/paper/batch?fields=${S2_FIELDS}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        ids: arxivIds.map((id) => `ArXiv:${id}`),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Semantic Scholar API error: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as (S2Paper | null)[];
}

async function updatePaper(
  supabase: ReturnType<typeof createSupabaseClient>,
  paper: PaperRow,
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

  return data as { cursor_value: string | null; imported_count: number } | null;
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
  const papers = await getPapersToEnrich(supabase, config.limit);

  if (!papers.length) {
    console.error("No papers found needing enrichment");
    return;
  }

  console.error(`Found ${papers.length} papers to enrich`);

  const cursor = await getCursor(supabase);
  let totalEnriched = cursor?.imported_count ?? 0;
  let totalFound = 0;
  let totalNotFound = 0;

  for (let i = 0; i < papers.length; i += config.batchSize) {
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.requestDelayMs));
    }

    const batch = papers.slice(i, i + config.batchSize);
    const arxivIds = batch.map((p) => p.arxiv_id);

    console.error(
      `Batch ${Math.floor(i / config.batchSize) + 1}: ${batch.length} papers`,
    );

    const s2Results = await fetchS2Batch(arxivIds, config.apiKey);

    let batchFound = 0;

    for (let j = 0; j < batch.length; j++) {
      const paper = batch[j];
      const s2 = s2Results[j];

      if (!s2) {
        totalNotFound++;
        continue;
      }

      totalFound++;
      batchFound++;

      if (!config.dryRun) {
        await updatePaper(supabase, paper, s2);
      }
    }

    if (!config.dryRun) {
      totalEnriched += batchFound;

      if (batch.length > 0) {
        const lastPaper = batch[batch.length - 1];
        await updateCursor(supabase, totalEnriched, lastPaper.id);
      }
    }
  }

  const summary = {
    mode: config.dryRun ? "dry-run" : "write",
    papersChecked: papers.length,
    enriched: totalFound,
    notFound: totalNotFound,
    totalEnriched: config.dryRun ? totalEnriched : totalEnriched,
  };

  console.log(JSON.stringify(summary));
}

void main();
