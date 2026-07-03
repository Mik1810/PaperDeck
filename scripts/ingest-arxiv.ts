import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { XMLParser } from "fast-xml-parser";
import { arxivCategoryLabels } from "../src/lib/arxiv-categories";

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

type TopicRow = {
  id: string;
  arxiv_category: string | null;
};

type IngestionCursor = {
  cursor_value: string | null;
  last_seen_published_at: string | null;
};

type IngestionConfig = {
  categories: string[];
  maxResults: number;
  start: number;
  dryRun: boolean;
  backfill: boolean;
  backfillPages: number;
  requestDelayMs: number;
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
    maxResults: Number(
      argValue("max-results") ?? process.env.ARXIV_MAX_RESULTS ?? 25,
    ),
    start: Number(argValue("start") ?? process.env.ARXIV_START ?? 0),
    dryRun: args.includes("--dry-run") || process.env.ARXIV_DRY_RUN === "true",
    backfill: args.includes("--backfill") || process.env.ARXIV_BACKFILL === "true",
    backfillPages: Number(
      argValue("backfill-pages") ?? process.env.ARXIV_BACKFILL_PAGES ?? 10,
    ),
    requestDelayMs: Number(process.env.ARXIV_REQUEST_DELAY_MS ?? 3100),
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

async function fetchArxivPapersForCategory(
  config: IngestionConfig,
  category: string,
) {
  const params = new URLSearchParams({
    search_query: `cat:${category}`,
    start: String(config.start),
    max_results: String(config.maxResults),
    sortBy: "submittedDate",
    sortOrder: "descending",
  });
  const response = await fetch(`https://export.arxiv.org/api/query?${params}`, {
    headers: {
      "User-Agent": config.userAgent,
    },
  });

  if (!response.ok) {
    throw new Error(`arXiv request failed: ${response.status} ${response.statusText}`);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: false,
  });
  const parsed = parser.parse(await response.text()) as {
    feed?: {
      entry?: Record<string, unknown> | Array<Record<string, unknown>>;
    };
  };

  return asArray(parsed.feed?.entry).map(parseEntry);
}

function cursorKey(category: string) {
  return `arxiv:${category}`;
}

function backfillCursorKey(category: string) {
  return `arxiv_backfill:${category}`;
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

  return new Set((data ?? []).map((row) => row.arxiv_id as string));
}

async function getBackfillCursor(
  supabase: ReturnType<typeof createSupabaseClient>,
  category: string,
) {
  const { data, error } = await supabase
    .from("ingestion_cursors")
    .select("cursor_value, last_seen_published_at")
    .eq("source", "arxiv")
    .eq("cursor_key", backfillCursorKey(category))
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as IngestionCursor | null;
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
    .select("cursor_value, last_seen_published_at")
    .eq("source", "arxiv")
    .eq("cursor_key", cursorKey(category))
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as IngestionCursor | null;
}

function isAfterCursor(paper: ArxivPaper, cursor: IngestionCursor | null) {
  if (!cursor?.last_seen_published_at) {
    return true;
  }

  return new Date(paper.publishedAt).getTime() >
    new Date(cursor.last_seen_published_at).getTime();
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

  const { error } = await supabase.from("ingestion_cursors").upsert(
    {
      source: "arxiv",
      cursor_key: cursorKey(category),
      cursor_value: newestPaper.publishedAt,
      last_seen_published_at: newestPaper.publishedAt,
      last_seen_external_id: newestPaper.arxivId,
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

async function ensureCategoryTopics(
  supabase: ReturnType<typeof createSupabaseClient>,
  categories: string[],
) {
  const uniqueCategories = [...new Set(categories)];

  for (const category of uniqueCategories) {
    const { data: existing, error: existingError } = await supabase
      .from("taxonomy_topics")
      .select("id")
      .eq("arxiv_category", category)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existing) {
      continue;
    }

    const { error: insertError } = await supabase.from("taxonomy_topics").insert({
      slug: slugForCategory(category),
      label: arxivCategoryLabels[category] ?? category,
      source: "arxiv",
      arxiv_category: category,
      depth: 0,
      sort_order: 1000,
    });

    if (insertError) {
      throw insertError;
    }
  }

  const { data, error } = await supabase
    .from("taxonomy_topics")
    .select("id, arxiv_category")
    .in("arxiv_category", uniqueCategories);

  if (error) {
    throw error;
  }

  return new Map(
    ((data ?? []) as TopicRow[])
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

  return data.id as string;
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
  const { data: existing, error: lookupError } = await supabase
    .from("papers")
    .select("id")
    .eq("arxiv_id", paper.arxivId)
    .maybeSingle();

  if (lookupError) {
    throw lookupError;
  }

  const payload = {
    title: paper.title,
    abstract: paper.abstract,
    year: paper.year,
    published_at: paper.publishedAt,
    updated_at: paper.updatedAt,
    source: "arxiv",
    doi: paper.doi,
    arxiv_id: paper.arxivId,
    url: paper.url,
    pdf_url: paper.pdfUrl,
    venue: paper.primaryCategory,
    is_open_access: true,
    access: "open",
  };
  const { data: saved, error: saveError } = existing
    ? await supabase
        .from("papers")
        .update(payload)
        .eq("id", existing.id)
        .select("id")
        .single()
    : await supabase.from("papers").insert(payload).select("id").single();

  if (saveError) {
    throw saveError;
  }

  if (!saved) {
    throw new Error(`Missing saved paper row for ${paper.arxivId}`);
  }

  const paperId = saved.id as string;
  const { error: externalIdError } = await supabase
    .from("paper_external_ids")
    .upsert(
      {
        paper_id: paperId,
        provider: "arxiv",
        external_id: paper.versionedArxivId,
        url: paper.url,
      },
      { onConflict: "paper_id,provider,external_id" },
    );

  if (externalIdError) {
    throw externalIdError;
  }

  const { error: deleteAuthorsError } = await supabase
    .from("paper_authors")
    .delete()
    .eq("paper_id", paperId);

  if (deleteAuthorsError) {
    throw deleteAuthorsError;
  }

  if (paper.authors.length) {
    const { error: authorsError } = await supabase.from("paper_authors").insert(
      paper.authors.map((name, position) => ({
        paper_id: paperId,
        name,
        position,
      })),
    );

    if (authorsError) {
      throw authorsError;
    }
  }

  const { error: deleteTopicsError } = await supabase
    .from("paper_topics")
    .delete()
    .eq("paper_id", paperId);

  if (deleteTopicsError) {
    throw deleteTopicsError;
  }

  const topicRows = paper.categories
    .map((category) => topicIdsByCategory.get(category))
    .filter((topicId): topicId is string => Boolean(topicId))
    .map((topicId) => ({
      paper_id: paperId,
      topic_id: topicId,
      confidence: 1,
      source: "arxiv_category",
    }));

  if (topicRows.length) {
    const { error: topicsError } = await supabase
      .from("paper_topics")
      .insert(topicRows);

    if (topicsError) {
      throw topicsError;
    }
  }
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

  try {
    const fetchedByCategory = [];

    if (config.backfill) {
      for (const [index, category] of config.categories.entries()) {
        if (index > 0) {
          await new Promise((resolve) => setTimeout(resolve, config.requestDelayMs));
        }

        const backfillCursor = await getBackfillCursor(supabase, category);
        const startOffset = backfillCursor?.cursor_value
          ? Number(backfillCursor.cursor_value)
          : config.maxResults;

        let currentStart = startOffset;
        const importablePapers: ArxivPaper[] = [];
        const allFetchedPapers: ArxivPaper[] = [];

        for (let page = 0; page < config.backfillPages; page++) {
          if (page > 0) {
            await new Promise((resolve) => setTimeout(resolve, config.requestDelayMs));
          }

          const fetchedPapers = await fetchArxivPapersForCategory(
            { ...config, start: currentStart },
            category,
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
      for (const [index, category] of config.categories.entries()) {
        if (index > 0) {
          await new Promise((resolve) => setTimeout(resolve, config.requestDelayMs));
        }

        const cursor = await getCategoryCursor(supabase, category);
        const fetchedPapers = await fetchArxivPapersForCategory(config, category);
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
    }

    const papers = uniquePapersByArxivId(
      fetchedByCategory.flatMap((item) => item.importablePapers),
    );

    if (config.dryRun) {
      console.log(
        JSON.stringify({
          mode: config.backfill ? "dry-run-backfill" : "dry-run",
          categories: config.categories,
          fetched: fetchedByCategory.reduce(
            (total, item) => total + item.fetchedPapers.length,
            0,
          ),
          importable: papers.length,
          firstPaper:
            fetchedByCategory.flatMap((item) => item.fetchedPapers)[0]
              ?.arxivId ?? null,
        }),
      );
      return;
    }

    const allCategories = [...new Set(papers.flatMap((paper) => paper.categories))];
    const topicIdsByCategory = await ensureCategoryTopics(supabase, allCategories);

    for (const paper of papers) {
      await upsertPaper(supabase, paper, topicIdsByCategory);
    }

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
        await updateCategoryCursor(
          supabase,
          item.category,
          item.fetchedPapers,
          item.importablePapers.length,
          runId,
        );
      }
    }

    const cursorSummary = JSON.stringify(
      Object.fromEntries(
        fetchedByCategory.map((item) => [
          item.category,
          item.fetchedPapers[0]?.publishedAt ?? null,
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
        imported: papers.length,
        fetched: fetchedByCategory.reduce(
          (total, item) => total + item.fetchedPapers.length,
          0,
        ),
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

void main();
