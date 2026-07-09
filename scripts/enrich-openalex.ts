import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  OACursorSchema,
  OAPaperRowArraySchema,
  OAResponseSchema,
  OATopicIdRowSchema,
  type OAWork,
  type OAPaperRow,
  type OATopic,
} from "../src/lib/schemas/oa-response";

type EnrichConfig = {
  batchSize: number;
  limit: number;
  dryRun: boolean;
  requestDelayMs: number;
  email: string | null;
};

const OA_BASE = "https://api.openalex.org";
const CURSOR_KEY = "openalex_enrich";

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
        process.env.OPENALEX_BATCH_SIZE ??
        25,
    ),
    limit: Number(
      argValue("limit") ?? process.env.OPENALEX_LIMIT ?? 500,
    ),
    dryRun:
      args.includes("--dry-run") || process.env.OPENALEX_DRY_RUN === "true",
    requestDelayMs: Number(
      process.env.OPENALEX_REQUEST_DELAY_MS ?? 200,
    ),
    email: process.env.OPENALEX_EMAIL ?? null,
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
    .select("id, arxiv_id, doi, venue, abstract, is_open_access, access, ingested_at")
    .eq("source", "arxiv")
    .is("openalex_id", null)
    .not("doi", "is", null)
    .order("ingested_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return OAPaperRowArraySchema.parse(data ?? []);
}

function reconstructAbstract(
  invertedIndex: Record<string, number[]> | null,
) {
  if (!invertedIndex) {
    return null;
  }

  const positions = new Map<number, string>();

  for (const [word, posList] of Object.entries(invertedIndex)) {
    for (const pos of posList) {
      positions.set(pos, word);
    }
  }

  const maxPos = Math.max(...positions.keys());
  const words: string[] = [];

  for (let i = 0; i <= maxPos; i++) {
    if (positions.has(i)) {
      words.push(positions.get(i)!);
    }
  }

  return words.join(" ");
}

function oaStatusToAccess(status: string) {
  if (status === "closed") {
    return "publisher";
  }

  return "open";
}

async function fetchOpenAlexBatch(
  dois: string[],
  config: EnrichConfig,
) {
  const filter = `doi:${dois.join("|")}`;
  const url = `${OA_BASE}/works?filter=${filter.replace(/\|/g, "%7C")}&per_page=${dois.length}`;

  const headers: Record<string, string> = {};

  if (config.email) {
    headers["User-Agent"] = `mailto:${config.email}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(
      `OpenAlex API error: ${response.status} ${response.statusText}`,
    );
  }

  return OAResponseSchema.parse(await response.json());
}

async function ensureOpenAlexTopic(
  supabase: ReturnType<typeof createSupabaseClient>,
  topic: OATopic,
) {
  const slug = `openalex:${topic.id.split("/").pop()}`;

  const { data: existing } = await supabase
    .from("taxonomy_topics")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (existing) {
    return OATopicIdRowSchema.parse(existing).id;
  }

  const { data: created, error } = await supabase
    .from("taxonomy_topics")
    .insert({
      slug,
      label: topic.display_name,
      source: "openalex",
      depth: 0,
      sort_order: 2000,
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return OATopicIdRowSchema.parse(created).id;
}

async function updatePaper(
  supabase: ReturnType<typeof createSupabaseClient>,
  paper: OAPaperRow,
  work: OAWork,
) {
  const updates: Record<string, unknown> = {
    openalex_id: work.id,
  };

  if (work.primary_location?.source?.display_name) {
    const venue = work.primary_location.source.display_name;

    if (venue && !paper.venue) {
      updates.venue = venue;
    }
  }

  if (work.open_access.is_oa) {
    updates.is_open_access = true;
    updates.access = oaStatusToAccess(work.open_access.oa_status);
  }

  if (!paper.doi && work.doi) {
    const rawDoi = work.doi.replace(/^https:\/\/doi\.org\//, "");
    updates.doi = rawDoi || work.doi;
  }

  if (!paper.abstract) {
    const reconstructed = reconstructAbstract(work.abstract_inverted_index);

    if (reconstructed) {
      updates.abstract = reconstructed;
    }
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
        provider: "openalex",
        external_id: work.id,
        url: work.id,
      },
      { onConflict: "paper_id,provider,external_id" },
    );

  if (externalIdError) {
    throw externalIdError;
  }

  if (work.doi) {
    const rawDoi = work.doi.replace(/^https:\/\/doi\.org\//, "");

    const { error: doiError } = await supabase
      .from("paper_external_ids")
      .upsert(
        {
          paper_id: paper.id,
          provider: "doi",
          external_id: rawDoi || work.doi,
          url: work.doi.startsWith("http") ? work.doi : `https://doi.org/${work.doi}`,
        },
        { onConflict: "paper_id,provider,external_id" },
      );

    if (doiError) {
      throw doiError;
    }
  }

  if (work.topics.length) {
    const topicIds: string[] = [];

    for (const topic of work.topics) {
      const topicId = await ensureOpenAlexTopic(supabase, topic);
      topicIds.push(topicId);
    }

    const topicRows = work.topics
      .map((_topic, index) => ({
        paper_id: paper.id,
        topic_id: topicIds[index],
        confidence: Math.round((_topic.score ?? 0.5) * 100) / 100,
        source: "openalex",
      }));

    if (topicRows.length) {
      const { error: topicsError } = await supabase
        .from("paper_topics")
        .upsert(
          topicRows,
          { onConflict: "paper_id,topic_id", ignoreDuplicates: true },
        );

      if (topicsError) {
        throw topicsError;
      }
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

  return OACursorSchema.parse(data);
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
    `Enriching up to ${config.limit} papers via OpenAlex (batch size ${config.batchSize}, dry-run: ${config.dryRun})`,
  );

  const supabase = createSupabaseClient();
  const papers = await getPapersToEnrich(supabase, config.limit);

  if (!papers.length) {
    console.error("No papers with DOI found needing OpenAlex enrichment");
    return;
  }

  console.error(`Found ${papers.length} papers with DOI to enrich`);

  const cursor = await getCursor(supabase);
  let totalEnriched = cursor?.imported_count ?? 0;
  let totalFound = 0;
  let totalNotFound = 0;

  for (let i = 0; i < papers.length; i += config.batchSize) {
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.requestDelayMs));
    }

    const batch = papers.slice(i, i + config.batchSize);
    const dois = batch.map((p) => p.doi).filter((d): d is string => Boolean(d));

    if (!dois.length) {
      continue;
    }

    console.error(
      `Batch ${Math.floor(i / config.batchSize) + 1}: ${batch.length} papers, ${dois.length} DOIs`,
    );

    const oaResponse = await fetchOpenAlexBatch(dois, config);
    const worksByDoi = new Map<string, OAWork>();

    for (const work of oaResponse.results) {
      const rawDoi = work.doi?.replace(/^https:\/\/doi\.org\//, "");
      worksByDoi.set(rawDoi, work);
    }

    let batchFound = 0;

    for (const paper of batch) {
      const work = paper.doi ? worksByDoi.get(paper.doi) : undefined;

      if (!work) {
        totalNotFound++;
        continue;
      }

      totalFound++;
      batchFound++;

      if (!config.dryRun) {
        await updatePaper(supabase, paper, work);
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
    totalEnriched,
  };

  console.log(JSON.stringify(summary));
}

void main();
