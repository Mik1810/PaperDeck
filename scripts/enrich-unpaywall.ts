import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

type EnrichConfig = {
  limit: number;
  dryRun: boolean;
  requestDelayMs: number;
  email: string;
};

type PaperRow = {
  id: string;
  arxiv_id: string | null;
  doi: string | null;
  is_open_access: boolean | null;
  pdf_url: string | null;
  ingested_at: string;
};

type UPLocation = {
  url: string | null;
  url_for_pdf: string | null;
  url_for_landing_page: string | null;
  host_type: string | null;
  version: string | null;
  license: string | null;
};

type UPResponse = {
  doi: string;
  is_oa: boolean;
  oa_status: string;
  best_oa_location: UPLocation | null;
  oa_locations: UPLocation[];
};

const UP_BASE = "https://api.unpaywall.org/v2";
const CURSOR_KEY = "unpaywall_enrich";

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
    limit: Number(
      argValue("limit") ?? process.env.UNPAYWALL_LIMIT ?? 500,
    ),
    dryRun:
      args.includes("--dry-run") || process.env.UNPAYWALL_DRY_RUN === "true",
    requestDelayMs: Number(
      process.env.UNPAYWALL_REQUEST_DELAY_MS ?? 500,
    ),
    email: requireEnv("UNPAYWALL_EMAIL"),
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
  const allPapers: PaperRow[] = [];
  let page = 0;
  const perPage = 100;

  while (allPapers.length < limit) {
    const from = page * perPage;
    const { data, error } = await supabase
      .from("papers")
      .select("id, arxiv_id, doi, is_open_access, pdf_url, ingested_at")
      .eq("source", "arxiv")
      .not("doi", "is", null)
      .order("ingested_at", { ascending: false })
      .range(from, from + perPage - 1);

    if (error) {
      throw error;
    }

    if (!data || !data.length) {
      break;
    }

    const paperIds = data.map((p) => p.id);

    const { data: existingExtIds, error: extError } = await supabase
      .from("paper_external_ids")
      .select("paper_id")
      .eq("provider", "unpaywall_oa")
      .in("paper_id", paperIds);

    if (extError) {
      throw extError;
    }

    const enrichedIds = new Set(
      (existingExtIds ?? []).map((row) => row.paper_id),
    );

    const notEnriched = (data as PaperRow[]).filter(
      (p) => !enrichedIds.has(p.id),
    );

    allPapers.push(...notEnriched);

    if (data.length < perPage) {
      break;
    }

    page++;
  }

  return allPapers.slice(0, limit);
}

async function fetchUnpaywall(doi: string, email: string) {
  const params = new URLSearchParams({ email });
  const query = params.size ? `?${params}` : "";
  const response = await fetch(`${UP_BASE}/${encodeURIComponent(doi)}${query}`);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `Unpaywall API error: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as UPResponse;
}

function bestOaUrl(best: UPLocation | null) {
  if (!best) {
    return null;
  }

  return best.url_for_pdf ?? best.url_for_landing_page ?? best.url ?? null;
}

async function enrichPaper(
  supabase: ReturnType<typeof createSupabaseClient>,
  paper: PaperRow,
  up: UPResponse,
) {
  const updates: Record<string, unknown> = {};

  if (up.is_oa && !paper.is_open_access) {
    updates.is_open_access = true;
  }

  const oaUrl = bestOaUrl(up.best_oa_location);

  if (oaUrl) {
    if (!paper.pdf_url) {
      updates.pdf_url = oaUrl;
    }

    const { error } = await supabase
      .from("paper_external_ids")
      .upsert(
        {
          paper_id: paper.id,
          provider: "unpaywall_oa",
          external_id: paper.doi ?? up.doi,
          url: oaUrl,
        },
        { onConflict: "paper_id,provider,external_id" },
      );

    if (error) {
      throw error;
    }
  }

  if (Object.keys(updates).length) {
    const { error } = await supabase
      .from("papers")
      .update(updates)
      .eq("id", paper.id);

    if (error) {
      throw error;
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
    `Enriching up to ${config.limit} papers via Unpaywall (dry-run: ${config.dryRun})`,
  );

  const supabase = createSupabaseClient();
  const papers = await getPapersToEnrich(supabase, config.limit);

  if (!papers.length) {
    console.error("No papers with DOI found needing Unpaywall enrichment");
    return;
  }

  console.error(`Found ${papers.length} papers with DOI to look up`);

  const cursor = await getCursor(supabase);
  let totalEnriched = cursor?.imported_count ?? 0;
  let totalOa = 0;
  let totalNotFound = 0;

  for (const [index, paper] of papers.entries()) {
    if (index > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.requestDelayMs));
    }

    const up = await fetchUnpaywall(paper.doi!, config.email);

    if (!up) {
      totalNotFound++;
      continue;
    }

    if (up.is_oa && up.best_oa_location) {
      totalOa++;

      if (!config.dryRun) {
        await enrichPaper(supabase, paper, up);
        totalEnriched++;
        await updateCursor(supabase, totalEnriched, paper.id);
      }
    }
  }

  const summary = {
    mode: config.dryRun ? "dry-run" : "write",
    papersChecked: papers.length,
    oaFound: totalOa,
    notFound: totalNotFound,
    totalEnriched,
  };

  console.log(JSON.stringify(summary));
}

void main();
