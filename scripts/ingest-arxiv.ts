import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { XMLParser } from "fast-xml-parser";
import { arxivCategoryLabels } from "../src/lib/arxiv-categories";
import { arxivRetryDelayMs } from "../src/lib/arxiv-retry";
import {
  ArxivFeedSchema,
  ArxivIdRowSchema,
  IngestionCursorSchema,
  RevisionCursorSchema,
  SingleIdRowSchema,
  TopicRowArraySchema,
  type IngestionCursor,
} from "../src/lib/schemas/arxiv-entry";
import {
  createRequestRateGate,
  hasPassedRevisionCursorTimestamp,
  isAfterRevisionCursor,
  mapWithConcurrency,
  parseBoundedPositiveInteger,
  parseIntegerInRange,
  withWholePaperRetry,
} from "./lib/arxiv-ingestion";

type ArxivPaper = {
  arxivId: string;
  versionedArxivId: string;
  title: string;
  abstract: string;
  authors: string[];
  categories: string[];
  publishedAt: string;
  updatedAt: string;
  year: number;
  doi: string | null;
  url: string;
  pdfUrl: string | null;
  primaryCategory: string | null;
};

type IngestionConfig = {
  categories: string[];
  maxResults: number;
  start: number;
  dryRun: boolean;
  backfill: boolean;
  backfillPages: number;
  requestDelayMs: number;
  databaseConcurrency: number;
  revisionPages: number;
  revisionSweep: boolean;
  userAgent: string;
};

const defaultCategories = [
  "cs.AI",
  "cs.CL",
  "cs.CR",
  "cs.CC",
  "cs.DS",
  "cs.LG",
  "cs.LO",
  "cs.PL",
  "cs.SE",
  "cs.SY",
];

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

function parseArgs(): IngestionConfig {
  const args = process.argv.slice(2);
  const argValue = (name: string) => {
    const prefix = `--${name}=`;
    return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  };
  const categories =
    argValue("categories")?.split(",") ??
    process.env.ARXIV_CATEGORIES?.split(",") ??
    defaultCategories;

  return {
    categories: categories.map((category) => category.trim()).filter(Boolean),
    maxResults: parseBoundedPositiveInteger(
      Number(argValue("max-results") ?? process.env.ARXIV_MAX_RESULTS ?? 25),
      "arXiv max results",
      2_000,
    ),
    start: parseIntegerInRange(
      Number(argValue("start") ?? process.env.ARXIV_START ?? 0),
      "arXiv start offset",
      0,
      1_000_000,
    ),
    dryRun: args.includes("--dry-run") || process.env.ARXIV_DRY_RUN === "true",
    backfill: args.includes("--backfill") || process.env.ARXIV_BACKFILL === "true",
    backfillPages: parseBoundedPositiveInteger(
      Number(
        argValue("backfill-pages") ??
          process.env.ARXIV_BACKFILL_PAGES ??
          10,
      ),
      "arXiv backfill pages",
      100,
    ),
    requestDelayMs: parseIntegerInRange(
      Number(process.env.ARXIV_REQUEST_DELAY_MS ?? 3100),
      "arXiv request delay",
      3_000,
      60_000,
    ),
    databaseConcurrency: parseBoundedPositiveInteger(
      Number(
        argValue("database-concurrency") ??
          process.env.ARXIV_DATABASE_CONCURRENCY ??
          4,
      ),
      "arXiv database concurrency",
      16,
    ),
    revisionPages: parseBoundedPositiveInteger(
      Number(
        argValue("revision-pages") ?? process.env.ARXIV_REVISION_PAGES ?? 10,
      ),
      "arXiv revision pages",
      100,
    ),
    revisionSweep:
      !args.includes("--no-revision-sweep") &&
      (args.includes("--revision-sweep") ||
        process.env.ARXIV_REVISION_SWEEP !== "false"),
    userAgent:
      process.env.ARXIV_USER_AGENT ??
      "PaperDeck/0.0.0 (https://paperdeck.michaelpiccirilli.it)",
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

function normalizeText(value: unknown) {
  if (value === null || typeof value === "undefined") {
    return "";
  }

  return String(value).replace(/\s+/g, " ").trim();
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === null || typeof value === "undefined") {
    return [];
  }

  return [value];
}

function slugForCategory(category: string) {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeArxivId(idUrl: string) {
  const versionedArxivId = idUrl.split("/abs/").at(-1)?.trim() ?? idUrl.trim();
  const arxivId = versionedArxivId.replace(/v\d+$/i, "");

  return {
    arxivId,
    versionedArxivId,
  };
}

function attr(record: Record<string, unknown>, name: string) {
  const value = record[`@_${name}`];

  return typeof value === "string" ? value : "";
}

function parseEntry(entry: Record<string, unknown>): ArxivPaper {
  const idUrl = normalizeText(entry.id);
  const { arxivId, versionedArxivId } = normalizeArxivId(idUrl);
  const categories = asArray(entry.category)
    .map((category) =>
      typeof category === "object" && category
        ? attr(category as Record<string, unknown>, "term")
        : "",
    )
    .filter((category) => category.startsWith("cs."));
  const links = asArray(entry.link).filter(
    (link): link is Record<string, unknown> =>
      typeof link === "object" && Boolean(link),
  );
  const pdfLink = links.find(
    (link) => attr(link, "title") === "pdf" || attr(link, "type") === "application/pdf",
  );
  const primaryCategory =
    typeof entry["arxiv:primary_category"] === "object" &&
    entry["arxiv:primary_category"]
      ? attr(entry["arxiv:primary_category"] as Record<string, unknown>, "term")
      : "";
  const publishedAt = normalizeText(entry.published);
  const updatedAt = normalizeText(entry.updated);

  return {
    arxivId,
    versionedArxivId,
    title: normalizeText(entry.title),
    abstract: normalizeText(entry.summary),
    authors: asArray(entry.author)
      .map((author) =>
        typeof author === "object" && author
          ? normalizeText((author as Record<string, unknown>).name)
          : "",
      )
      .filter(Boolean),
    categories,
    publishedAt,
    updatedAt,
    year: publishedAt
      ? new Date(publishedAt).getUTCFullYear()
      : new Date().getUTCFullYear(),
    doi: normalizeText(entry["arxiv:doi"]) || null,
    url: `https://arxiv.org/abs/${arxivId}`,
    pdfUrl: pdfLink ? attr(pdfLink, "href") : `https://arxiv.org/pdf/${arxivId}`,
    primaryCategory: primaryCategory || categories[0] || null,
  };
}

const ARXIV_MAX_RETRIES = 3;

class ArxivRequestError extends Error {
  constructor(
    readonly status: number,
    statusText: string,
  ) {
    super(`arXiv request failed: ${status} ${statusText}`);
    this.name = "ArxivRequestError";
  }
}

function isRetryableStatus(status: number) {
  return status === 429 || status >= 500;
}

function isNetworkError(error: unknown): error is TypeError {
  return error instanceof TypeError && error.message.includes("fetch");
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  beforeRequest: () => Promise<void>,
  maxRetries = ARXIV_MAX_RETRIES,
) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await beforeRequest();
      const response = await fetch(url, options);

      if (isRetryableStatus(response.status) && attempt < maxRetries) {
        const waitMs = arxivRetryDelayMs(
          response.status,
          attempt,
          response.headers.get("retry-after"),
        );
        console.error(
          `arXiv HTTP ${response.status} (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${Math.round(waitMs / 1000)}s...`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      return response;
    } catch (error) {
      if (isNetworkError(error)) {
        if (attempt < maxRetries) {
          const waitMs = arxivRetryDelayMs(503, attempt, null);
          console.error(
            `Network error (attempt ${attempt + 1}/${maxRetries + 1}): ${error.message}, retrying in ${Math.round(waitMs / 1000)}s...`,
          );
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        throw new ArxivRequestError(503, "Network error");
      }

      throw error;
    }
  }

  throw new Error(`Max arXiv retries (${maxRetries}) exceeded for ${url}`);
}

async function fetchArxivPapersForCategory(
  config: IngestionConfig,
  category: string,
  options: {
    beforeRequest: () => Promise<void>;
    sortBy?: "lastUpdatedDate" | "submittedDate";
    start?: number;
  },
) {
  const params = new URLSearchParams({
    search_query: `cat:${category}`,
    start: String(options.start ?? config.start),
    max_results: String(config.maxResults),
    sortBy: options.sortBy ?? "submittedDate",
    sortOrder: "descending",
  });
  const response = await fetchWithRetry(
    `https://export.arxiv.org/api/query?${params}`,
    {
      headers: {
        "User-Agent": config.userAgent,
      },
    },
    options.beforeRequest,
  );

  if (!response.ok) {
    throw new ArxivRequestError(response.status, response.statusText);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: false,
  });
  const parsed = ArxivFeedSchema.parse(parser.parse(await response.text()));

  return asArray(parsed.feed?.entry).map(parseEntry);
}

function cursorKey(category: string) {
  return `arxiv:${category}`;
}

function backfillCursorKey(category: string) {
  return `arxiv_backfill:${category}`;
}

function revisionCursorKey(category: string) {
  return `arxiv_revisions:${category}`;
}

async function getExistingArxivIds(
  supabase: ReturnType<typeof createSupabaseClient>,
  arxivIds: string[],
) {
  if (!arxivIds.length) {
    return new Set<string>();
  }

  const { data, error } = await supabase
    .from("papers")
    .select("arxiv_id")
    .in("arxiv_id", arxivIds);

  if (error) {
    throw error;
  }

  return new Set((data ?? []).map((row) => ArxivIdRowSchema.parse(row).arxiv_id));
}

async function getBackfillCursor(
  supabase: ReturnType<typeof createSupabaseClient>,
  category: string,
) {
  const { data, error } = await supabase
    .from("ingestion_cursors")
    .select("cursor_value, last_seen_published_at, last_seen_external_id")
    .eq("source", "arxiv")
    .eq("cursor_key", backfillCursorKey(category))
    .maybeSingle();

  if (error) {
    throw error;
  }

  return IngestionCursorSchema.parse(data);
}

async function updateBackfillCursor(
  supabase: ReturnType<typeof createSupabaseClient>,
  category: string,
  start: number,
  papers: ArxivPaper[],
  importedCount: number,
  runId: string | null,
) {
  const oldestPaper = papers
    .filter((paper) => paper.publishedAt)
    .sort(
      (a, b) =>
        new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime(),
    )[0];

  const { error } = await supabase.from("ingestion_cursors").upsert(
    {
      source: "arxiv",
      cursor_key: backfillCursorKey(category),
      cursor_value: String(start),
      last_seen_published_at: oldestPaper?.publishedAt ?? null,
      last_seen_external_id: oldestPaper?.arxivId ?? null,
      last_successful_run_id: runId,
      imported_count: importedCount,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "source,cursor_key" },
  );

  if (error) {
    throw error;
  }
}

async function getCategoryCursor(
  supabase: ReturnType<typeof createSupabaseClient>,
  category: string,
) {
  const { data, error } = await supabase
    .from("ingestion_cursors")
    .select("cursor_value, last_seen_published_at, last_seen_external_id")
    .eq("source", "arxiv")
    .eq("cursor_key", cursorKey(category))
    .maybeSingle();

  if (error) {
    throw error;
  }

  return IngestionCursorSchema.parse(data);
}

async function getRevisionCursor(
  supabase: ReturnType<typeof createSupabaseClient>,
  category: string,
) {
  const { data, error } = await supabase
    .from("ingestion_cursors")
    .select("cursor_value, last_seen_updated_at, last_seen_external_id")
    .eq("source", "arxiv")
    .eq("cursor_key", revisionCursorKey(category))
    .maybeSingle();

  if (error) throw error;
  return RevisionCursorSchema.parse(data);
}

function isAfterCursor(paper: ArxivPaper, cursor: IngestionCursor | null) {
  if (!cursor?.last_seen_published_at) {
    return true;
  }

  const paperTime = new Date(paper.publishedAt).getTime();
  const cursorTime = new Date(cursor.last_seen_published_at).getTime();

  if (paperTime > cursorTime) return true;
  if (paperTime < cursorTime) return false;

  if (cursor.last_seen_external_id) {
    return paper.arxivId > cursor.last_seen_external_id;
  }

  return false;
}

async function updateCategoryCursor(
  supabase: ReturnType<typeof createSupabaseClient>,
  category: string,
  papers: ArxivPaper[],
  importedCount: number,
  runId: string | null,
) {
  const newestPaper = papers
    .filter((paper) => paper.publishedAt)
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    )[0];

  if (!newestPaper) {
    return;
  }

  const { error } = await supabase.rpc("upsert_arxiv_ingestion_cursor", {
    p_cursor_key: cursorKey(category),
    p_cursor_value: newestPaper.publishedAt,
    p_last_seen_published_at: newestPaper.publishedAt,
    p_last_seen_updated_at: null,
    p_last_seen_external_id: newestPaper.arxivId,
    p_last_successful_run_id: runId,
    p_imported_count: importedCount,
  });

  if (error) {
    throw error;
  }
}

async function updateRevisionCursor(
  supabase: ReturnType<typeof createSupabaseClient>,
  category: string,
  papers: ArxivPaper[],
  importedCount: number,
  runId: string | null,
) {
  const newestPaper = papers
    .filter((paper) => paper.updatedAt)
    .sort((left, right) => {
      const timeDifference =
        new Date(right.updatedAt).getTime() -
        new Date(left.updatedAt).getTime();
      return timeDifference || right.arxivId.localeCompare(left.arxivId);
    })[0];
  if (!newestPaper) return;

  const { error } = await supabase.rpc("upsert_arxiv_ingestion_cursor", {
    p_cursor_key: revisionCursorKey(category),
    p_cursor_value: newestPaper.updatedAt,
    p_last_seen_published_at: null,
    p_last_seen_updated_at: newestPaper.updatedAt,
    p_last_seen_external_id: newestPaper.arxivId,
    p_last_successful_run_id: runId,
    p_imported_count: importedCount,
  });
  if (error) throw error;
}

async function fetchRevisionPapersForCategory(
  config: IngestionConfig,
  category: string,
  cursor: Awaited<ReturnType<typeof getRevisionCursor>>,
  beforeRequest: () => Promise<void>,
) {
  const fetchedPapers: ArxivPaper[] = [];
  const importablePapers: ArxivPaper[] = [];

  for (let page = 0; page < config.revisionPages; page += 1) {
    const pagePapers = await fetchArxivPapersForCategory(config, category, {
      beforeRequest,
      sortBy: "lastUpdatedDate",
      start: page * config.maxResults,
    });
    fetchedPapers.push(...pagePapers);
    importablePapers.push(
      ...pagePapers.filter((paper) => isAfterRevisionCursor(paper, cursor)),
    );

    if (
      !cursor?.last_seen_updated_at ||
      pagePapers.length < config.maxResults ||
      hasPassedRevisionCursorTimestamp(pagePapers, cursor)
    ) {
      return { fetchedPapers, importablePapers };
    }
  }

  throw new Error(
    `arXiv revision sweep for ${category} exceeded ${config.revisionPages} pages before reaching its cursor`,
  );
}

async function ensureCategoryTopics(
  supabase: ReturnType<typeof createSupabaseClient>,
  categories: string[],
) {
  const uniqueCategories = [...new Set(categories)];
  if (!uniqueCategories.length) return new Map<string, string>();

  const { error: insertError } = await supabase.from("taxonomy_topics").upsert(
    uniqueCategories.map((category) => ({
      slug: slugForCategory(category),
      label: arxivCategoryLabels[category] ?? category,
      source: "arxiv",
      arxiv_category: category,
      depth: 0,
      sort_order: 1000,
    })),
    { ignoreDuplicates: true, onConflict: "slug" },
  );
  if (insertError) {
    throw insertError;
  }

  const { data, error } = await supabase
    .from("taxonomy_topics")
    .select("id, arxiv_category")
    .in("arxiv_category", uniqueCategories);

  if (error) {
    throw error;
  }

  return new Map(
    TopicRowArraySchema.parse(data ?? [])
      .filter((topic) => topic.arxiv_category)
      .map((topic) => [topic.arxiv_category as string, topic.id]),
  );
}

async function createIngestionRun(
  supabase: ReturnType<typeof createSupabaseClient>,
  dryRun: boolean,
) {
  if (dryRun) {
    return null;
  }

  const { data, error } = await supabase
    .from("ingestion_runs")
    .insert({
      source: "arxiv",
      status: "running",
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return SingleIdRowSchema.parse(data).id;
}

async function finishIngestionRun(
  supabase: ReturnType<typeof createSupabaseClient>,
  runId: string | null,
  status: "completed" | "failed",
  importedCount: number,
  cursorValue?: string,
  errorMessage?: string,
) {
  if (!runId) {
    return;
  }

  const { error } = await supabase
    .from("ingestion_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      cursor_value: cursorValue ?? null,
      imported_count: importedCount,
      error_message: errorMessage ?? null,
    })
    .eq("id", runId);

  if (error) {
    throw error;
  }
}

async function upsertPaper(
  supabase: ReturnType<typeof createSupabaseClient>,
  paper: ArxivPaper,
  topicIdsByCategory: Map<string, string>,
) {
  return withWholePaperRetry(async () => {
    const { data, error } = await supabase.rpc("upsert_arxiv_paper_bundle", {
      p_bundle: {
        abstract: paper.abstract,
        arxiv_id: paper.arxivId,
        authors: paper.authors,
        doi: paper.doi,
        pdf_url: paper.pdfUrl,
        published_at: paper.publishedAt,
        title: paper.title,
        topic_ids: [
          ...new Set(
            paper.categories
              .map((category) => topicIdsByCategory.get(category))
              .filter((topicId): topicId is string => Boolean(topicId)),
          ),
        ],
        updated_at: paper.updatedAt,
        url: paper.url,
        venue: paper.primaryCategory,
        versioned_arxiv_id: paper.versionedArxivId,
        year: paper.year,
      },
    });
    if (error) throw error;
    if (typeof data !== "string") {
      throw new Error(`Missing saved paper row for ${paper.arxivId}`);
    }
    return data;
  });
}

function uniquePapersByArxivId(papers: ArxivPaper[]) {
  return [...new Map(papers.map((paper) => [paper.arxivId, paper])).values()];
}

async function main() {
  loadLocalEnv();
  const config = parseArgs();

  if (!config.categories.length) {
    throw new Error("At least one arXiv category is required");
  }

  const supabase = createSupabaseClient();
  const runId = await createIngestionRun(supabase, config.dryRun);
  const beforeArxivRequest = createRequestRateGate(config.requestDelayMs);

  try {
    const fetchedByCategory = [];

    if (config.backfill) {
      for (const category of config.categories) {
        const backfillCursor = await getBackfillCursor(supabase, category);
        const startOffset = backfillCursor?.cursor_value
          ? Number(backfillCursor.cursor_value)
          : config.maxResults;

        let currentStart = startOffset;
        const importablePapers: ArxivPaper[] = [];
        const allFetchedPapers: ArxivPaper[] = [];

        for (let page = 0; page < config.backfillPages; page++) {
          const fetchedPapers = await fetchArxivPapersForCategory(
            config,
            category,
            { beforeRequest: beforeArxivRequest, start: currentStart },
          );

          if (!fetchedPapers.length) {
            break;
          }

          allFetchedPapers.push(...fetchedPapers);

          const existingIds = await getExistingArxivIds(
            supabase,
            fetchedPapers.map((paper) => paper.arxivId),
          );

          const newPapers = fetchedPapers.filter(
            (paper) => !existingIds.has(paper.arxivId),
          );

          if (newPapers.length === 0) {
            break;
          }

          importablePapers.push(...newPapers);
          currentStart += config.maxResults;
        }

        fetchedByCategory.push({
          category,
          cursor: null,
          fetchedPapers: allFetchedPapers,
          importablePapers,
          backfillStart: currentStart,
        });
      }
    } else {
      for (const category of config.categories) {
        const cursor = await getCategoryCursor(supabase, category);
        const fetchedPapers = await fetchArxivPapersForCategory(config, category, {
          beforeRequest: beforeArxivRequest,
        });
        const importablePapers = fetchedPapers.filter((paper) =>
          isAfterCursor(paper, cursor),
        );

        fetchedByCategory.push({
          category,
          cursor,
          fetchedPapers,
          importablePapers,
        });
      }

      if (config.revisionSweep) {
        for (const category of config.categories) {
          const cursor = await getRevisionCursor(supabase, category);
          const { fetchedPapers, importablePapers } =
            await fetchRevisionPapersForCategory(
              config,
              category,
              cursor,
              beforeArxivRequest,
            );
          fetchedByCategory.push({
            category,
            cursor: null,
            fetchedPapers,
            importablePapers,
            revisionCursor: cursor,
            revisionSweep: true,
          });
        }
      }
    }

    const categoryBreakdown = fetchedByCategory.map((item) => ({
      category: item.category,
      path: item.revisionSweep ? "revision" : config.backfill ? "backfill" : "new",
      fetched: item.fetchedPapers.length,
      importable: item.importablePapers.length,
      skipped: item.fetchedPapers.length - item.importablePapers.length,
      cursorHint:
        item.revisionCursor?.last_seen_updated_at ??
        item.cursor?.last_seen_published_at ??
        null,
      firstFetched: item.revisionSweep
        ? (item.fetchedPapers[0]?.updatedAt ?? null)
        : (item.fetchedPapers[0]?.publishedAt ?? null),
      lastFetched: item.revisionSweep
        ? (item.fetchedPapers[item.fetchedPapers.length - 1]?.updatedAt ?? null)
        : (item.fetchedPapers[item.fetchedPapers.length - 1]?.publishedAt ??
          null),
    }));

    const papers = uniquePapersByArxivId(
      fetchedByCategory.flatMap((item) => item.importablePapers),
    );

    if (config.dryRun) {
      console.log(
        JSON.stringify({
          mode: config.backfill ? "dry-run-backfill" : "dry-run",
          categories: config.categories,
          databaseConcurrency: config.databaseConcurrency,
          revisionSweep: config.revisionSweep,
          fetched: fetchedByCategory.reduce(
            (total, item) => total + item.fetchedPapers.length,
            0,
          ),
          importable: papers.length,
          firstPaper:
            fetchedByCategory.flatMap((item) => item.fetchedPapers)[0]
              ?.arxivId ?? null,
          categoryBreakdown,
        }),
      );
      return;
    }

    const allCategories = [...new Set(papers.flatMap((paper) => paper.categories))];
    const topicIdsByCategory = await ensureCategoryTopics(supabase, allCategories);

    await mapWithConcurrency(papers, config.databaseConcurrency, (paper) =>
      upsertPaper(supabase, paper, topicIdsByCategory),
    );

    if (config.backfill) {
      for (const item of fetchedByCategory) {
        if (item.backfillStart !== undefined) {
          await updateBackfillCursor(
            supabase,
            item.category,
            item.backfillStart,
            item.fetchedPapers,
            item.importablePapers.length,
            runId,
          );
        }
      }
    } else {
      for (const item of fetchedByCategory) {
        if (item.revisionSweep) {
          await updateRevisionCursor(
            supabase,
            item.category,
            item.fetchedPapers,
            item.importablePapers.length,
            runId,
          );
        } else {
          await updateCategoryCursor(
            supabase,
            item.category,
            item.fetchedPapers,
            item.importablePapers.length,
            runId,
          );
        }
      }
    }

    const cursorSummary = JSON.stringify(
      Object.fromEntries(
        fetchedByCategory.map((item) => [
          `${item.category}:${item.revisionSweep ? "revision" : config.backfill ? "backfill" : "new"}`,
          item.revisionSweep
            ? (item.fetchedPapers[0]?.updatedAt ?? null)
            : (item.fetchedPapers[0]?.publishedAt ?? null),
        ]),
      ),
    );

    await finishIngestionRun(
      supabase,
      runId,
      "completed",
      papers.length,
      cursorSummary,
    );
    console.log(
      JSON.stringify({
        mode: config.backfill ? "write-backfill" : "write",
        categories: config.categories,
        databaseConcurrency: config.databaseConcurrency,
        revisionSweep: config.revisionSweep,
        imported: papers.length,
        fetched: fetchedByCategory.reduce(
          (total, item) => total + item.fetchedPapers.length,
          0,
        ),
        categoryBreakdown,
      }),
    );
  } catch (error) {
    await finishIngestionRun(
      supabase,
      runId,
      "failed",
      0,
      undefined,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

function describeIngestionFailure(error: unknown) {
  if (error instanceof ArxivRequestError) {
    return {
      mode: "error",
      failure:
        error.status === 429
          ? "arxiv-rate-limit"
          : error.status >= 500
            ? "arxiv-upstream"
            : "arxiv-request",
      status: error.status,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      mode: "error",
      failure: "ingestion",
      message: error.message,
    };
  }

  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown; status?: unknown };
    const message =
      typeof candidate.message === "string"
        ? candidate.message
        : "Supabase request failed";
    const status =
      typeof candidate.status === "number" ? candidate.status : undefined;
    const authFailure =
      status === 401 || /invalid api key|jwt|unauthorized/i.test(message);

    return {
      mode: "error",
      failure: authFailure ? "supabase-auth" : "supabase",
      ...(typeof candidate.code === "string" ? { code: candidate.code } : {}),
      ...(status ? { status } : {}),
      message,
    };
  }

  return {
    mode: "error",
    failure: "ingestion",
    message: String(error),
  };
}

void main().catch((error) => {
  console.error(JSON.stringify(describeIngestionFailure(error)));
  process.exitCode = 1;
});
