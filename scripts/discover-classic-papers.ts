import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  arxivCategoryDescriptions,
  arxivCategoryLabels,
} from "../src/lib/arxiv-categories";

type DiscoveryQuerySeed = {
  query: string;
  topics?: string[];
  minCitations?: number;
  titleAll?: string[];
  titleAny?: string[];
};

type DiscoveryProfile = {
  category: string;
  areaLabel: string;
  areaDescription: string;
  query: string;
  topics: string[];
  minCitations: number;
  titleAll?: string[];
  titleAny?: string[];
};

type ClassicDiscoveryArea = {
  category: string;
  relatedCategories?: string[];
  minCitations: number;
  querySeeds: DiscoveryQuerySeed[];
};

type DiscoverConfig = {
  dryRun: boolean;
  perQuery: number;
  maxNewPerQuery: number;
  maxYear: number;
  requestDelayMs: number;
  categories: Set<string> | null;
  only: Set<string> | null;
};

type S2Paper = {
  paperId: string;
  externalIds?: {
    ArXiv?: string;
    DOI?: string;
    CorpusId?: number;
  };
  title?: string;
  abstract?: string | null;
  authors?: Array<{ name?: string }>;
  citationCount?: number;
  year?: number | null;
  venue?: string | null;
  url?: string | null;
  publicationDate?: string | null;
  openAccessPdf?: { url?: string | null } | null;
};

type S2SearchResponse = {
  data?: S2Paper[];
};

type ExistingPaper = {
  id: string;
  title: string;
  abstract: string | null;
  url: string;
  pdf_url: string | null;
  doi: string | null;
  arxiv_id: string | null;
  semantic_scholar_id: string | null;
  source: "arxiv" | "semantic_scholar" | "openalex" | "dblp" | "crossref" | "manual";
  venue: string | null;
  citation_count: number | null;
  year: number | null;
  published_at: string | null;
  is_open_access: boolean | null;
  access: "open" | "publisher" | "unknown";
};

const S2_BASE = "https://api.semanticscholar.org/graph/v1";
const S2_FIELDS =
  "paperId,externalIds,title,abstract,authors,citationCount,year,venue,url,publicationDate,openAccessPdf";
const EXISTING_PAPER_SELECT =
  "id,title,abstract,url,pdf_url,doi,arxiv_id,semantic_scholar_id,source,venue,citation_count,year,published_at,is_open_access,access";

const classicDiscoveryAreas: ClassicDiscoveryArea[] = [
  {
    category: "cs.CL",
    relatedCategories: ["cs.LG"],
    minCitations: 2000,
    querySeeds: [
      {
        query: "transformer neural machine translation",
        titleAny: ["attention", "transformer"],
      },
      {
        query: "language representation pretraining",
        titleAny: ["bert", "pre-trained", "pretraining", "representation"],
      },
    ],
  },
  {
    category: "cs.CV",
    relatedCategories: ["cs.LG"],
    minCitations: 5000,
    querySeeds: [
      {
        query: "deep residual learning image recognition",
        titleAny: ["residual", "resnet", "image recognition"],
      },
    ],
  },
  {
    category: "cs.LG",
    relatedCategories: ["cs.CV"],
    minCitations: 2000,
    querySeeds: [
      {
        query: "generative adversarial networks",
        topics: ["cs.LG"],
        minCitations: 5000,
        titleAny: ["generative adversarial", "gan", "gans"],
      },
      {
        query: "diffusion probabilistic models",
        titleAny: ["diffusion"],
      },
    ],
  },
  {
    category: "cs.DC",
    relatedCategories: ["cs.DB"],
    minCitations: 500,
    querySeeds: [
      {
        query: "distributed storage key value store consensus",
        titleAny: [
          "mapreduce",
          "bigtable",
          "dynamo",
          "paxos",
          "raft",
          "spanner",
          "cassandra",
          "consensus",
          "distributed",
        ],
      },
    ],
  },
  {
    category: "cs.DB",
    minCitations: 500,
    querySeeds: [
      {
        query: "database relational model",
        titleAll: ["relational", "database"],
        titleAny: ["model", "management", "system", "systems"],
      },
    ],
  },
  {
    category: "cs.IR",
    relatedCategories: ["cs.SI"],
    minCitations: 500,
    querySeeds: [
      {
        query: "web search pagerank information retrieval",
        titleAny: ["pagerank", "web search", "search engine", "information retrieval"],
      },
    ],
  },
  {
    category: "cs.CR",
    relatedCategories: ["cs.DC"],
    minCitations: 500,
    querySeeds: [
      {
        query: "byzantine fault tolerance distributed systems",
        topics: ["cs.CR", "cs.DC"],
        titleAny: ["byzantine", "fault tolerance"],
      },
      {
        query: "authentication logic cryptographic protocols",
        topics: ["cs.CR"],
        titleAny: ["authentication", "cryptographic", "protocol"],
      },
    ],
  },
  {
    category: "cs.PL",
    relatedCategories: ["cs.DC"],
    minCitations: 500,
    querySeeds: [
      {
        query: "communicating sequential processes programming languages",
        titleAny: ["communicating sequential processes", "sequential processes"],
      },
    ],
  },
  {
    category: "cs.CC",
    minCitations: 500,
    querySeeds: [
      {
        query: "computational complexity interactive proofs",
        titleAny: ["interactive proof", "interactive proofs", "complexity"],
      },
    ],
  },
  {
    category: "cs.OS",
    minCitations: 500,
    querySeeds: [
      {
        query: "unix time sharing system operating systems",
        titleAny: ["unix", "operating system", "operating systems"],
      },
      {
        query: "operating system kernels virtual memory file systems",
        titleAny: ["kernel", "kernels", "virtual memory", "file system", "file systems"],
      },
    ],
  },
  {
    category: "cs.SE",
    minCitations: 500,
    querySeeds: [
      {
        query: "empirical software engineering",
        titleAll: ["software"],
        titleAny: ["empirical", "systematic", "case study", "metrics", "engineering"],
      },
    ],
  },
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

function splitArgList(value: string | null | undefined) {
  return value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean) ?? [];
}

function selectorKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function parseArgs(): DiscoverConfig {
  const args = process.argv.slice(2);
  const argValue = (name: string) => {
    const prefix = `--${name}=`;
    return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  };
  const only = argValue("only");
  const categories =
    argValue("categories") ??
    argValue("areas") ??
    process.env.CLASSIC_DISCOVERY_CATEGORIES;

  return {
    dryRun: args.includes("--dry-run"),
    perQuery: Number(argValue("per-query") ?? process.env.CLASSIC_DISCOVERY_PER_QUERY ?? 8),
    maxNewPerQuery: Number(
      argValue("max-new-per-query") ??
        process.env.CLASSIC_DISCOVERY_MAX_NEW_PER_QUERY ??
        2,
    ),
    maxYear: Number(argValue("max-year") ?? process.env.CLASSIC_DISCOVERY_MAX_YEAR ?? 2020),
    requestDelayMs: Number(
      process.env.CLASSIC_DISCOVERY_REQUEST_DELAY_MS ?? 1100,
    ),
    categories: categories
      ? new Set(splitArgList(categories).map(selectorKey))
      : null,
    only: only ? new Set(splitArgList(only)) : null,
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response: Response, attempt: number) {
  const retryAfter = response.headers.get("retry-after");
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : 0;

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }

  const baseDelay = Number(process.env.CLASSIC_DISCOVERY_RETRY_DELAY_MS ?? 10000);

  return baseDelay * attempt;
}

function slugForCategory(category: string) {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeArxivId(value: string | null | undefined) {
  return value?.replace(/^arXiv:/i, "").replace(/v\d+$/i, "").trim() || null;
}

function normalizeDoi(value: string | null | undefined) {
  return value?.replace(/^https:\/\/doi\.org\//i, "").trim() || null;
}

function paperUrl(paper: S2Paper) {
  const arxivId = normalizeArxivId(paper.externalIds?.ArXiv);
  const doi = normalizeDoi(paper.externalIds?.DOI);

  return (
    (arxivId ? `https://arxiv.org/abs/${arxivId}` : null) ??
    (doi ? `https://doi.org/${doi}` : null) ??
    paper.url ??
    `https://www.semanticscholar.org/paper/${paper.paperId}`
  );
}

function paperPdfUrl(paper: S2Paper) {
  const arxivId = normalizeArxivId(paper.externalIds?.ArXiv);

  return paper.openAccessPdf?.url ?? (arxivId ? `https://arxiv.org/pdf/${arxivId}` : null);
}

function paperAuthors(paper: S2Paper) {
  return paper.authors
    ?.map((author) => author.name?.trim())
    .filter((name): name is string => Boolean(name)) ?? [];
}

function sourceForPaper(paper: S2Paper) {
  return normalizeArxivId(paper.externalIds?.ArXiv) ? "arxiv" : "semantic_scholar";
}

function normalizedTitle(paper: S2Paper) {
  return paper.title?.toLowerCase().replace(/\s+/g, " ").trim() ?? "";
}

function titleFingerprint(value: string | null | undefined) {
  return value
    ?.normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ") ?? "";
}

function matchesTitleGuard(paper: S2Paper, profile: DiscoveryProfile) {
  const title = normalizedTitle(paper);

  if (profile.titleAll?.some((term) => !title.includes(term))) {
    return false;
  }

  if (profile.titleAny?.length && !profile.titleAny.some((term) => title.includes(term))) {
    return false;
  }

  return true;
}

function categoryLabel(category: string) {
  return arxivCategoryLabels[category] ?? category;
}

function categoryDescription(category: string) {
  return arxivCategoryDescriptions[category] ?? categoryLabel(category);
}

function categoryTopics(area: ClassicDiscoveryArea, seed: DiscoveryQuerySeed) {
  return seed.topics ?? [area.category, ...(area.relatedCategories ?? [])];
}

function areaMatchesSelection(area: ClassicDiscoveryArea, selectedCategories: Set<string>) {
  return [
    area.category,
    categoryLabel(area.category),
    slugForCategory(area.category),
  ].some((value) => selectedCategories.has(selectorKey(value)));
}

function discoveryAreasFor(config: DiscoverConfig) {
  if (!config.categories) {
    return classicDiscoveryAreas;
  }

  return classicDiscoveryAreas.filter((area) =>
    areaMatchesSelection(area, config.categories as Set<string>),
  );
}

function profileForSeed(area: ClassicDiscoveryArea, seed: DiscoveryQuerySeed) {
  return {
    category: area.category,
    areaLabel: categoryLabel(area.category),
    areaDescription: categoryDescription(area.category),
    query: seed.query,
    topics: categoryTopics(area, seed),
    minCitations: seed.minCitations ?? area.minCitations,
    titleAll: seed.titleAll,
    titleAny: seed.titleAny,
  } satisfies DiscoveryProfile;
}

function discoveryProfilesFor(areas: ClassicDiscoveryArea[], config: DiscoverConfig) {
  const profiles = areas.flatMap((area) =>
    area.querySeeds.map((seed) => profileForSeed(area, seed)),
  );

  if (!config.only) {
    return profiles;
  }

  return profiles.filter((profile) => config.only?.has(profile.query));
}

function discoveryAreaSummaries(profiles: DiscoveryProfile[]) {
  const summaries = new Map<
    string,
    { category: string; label: string; description: string; queryCount: number }
  >();

  for (const profile of profiles) {
    const existing = summaries.get(profile.category);

    summaries.set(profile.category, {
      category: profile.category,
      label: profile.areaLabel,
      description: profile.areaDescription,
      queryCount: (existing?.queryCount ?? 0) + 1,
    });
  }

  return [...summaries.values()];
}

async function fetchSemanticScholarCandidates(
  profile: DiscoveryProfile,
  config: DiscoverConfig,
) {
  const params = new URLSearchParams({
    query: profile.query,
    fields: S2_FIELDS,
    limit: String(config.perQuery),
    sort: "citationCount:desc",
    year: `1970-${config.maxYear}`,
  });
  const headers: Record<string, string> = {};

  if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
    headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;
  }

  const retries = Number(process.env.CLASSIC_DISCOVERY_RETRIES ?? 3);

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const response = await fetch(`${S2_BASE}/paper/search/bulk?${params}`, {
      headers,
    });

    if (response.ok) {
      const body = (await response.json()) as S2SearchResponse;

      return (body.data ?? [])
        .filter(
          (paper) =>
            paper.paperId &&
            paper.title &&
            matchesTitleGuard(paper, profile) &&
            (paper.citationCount ?? 0) >= profile.minCitations &&
            (paper.year ?? 9999) <= config.maxYear,
        )
        .slice(0, config.perQuery);
    }

    const retryable = [429, 500, 502, 503, 504].includes(response.status);

    if (retryable && attempt <= retries) {
      await sleep(retryDelayMs(response, attempt));
      continue;
    }

    throw new Error(
      `Semantic Scholar API error: ${response.status} ${response.statusText}`,
    );
  }

  throw new Error("Semantic Scholar API request exhausted retries");
}

async function ensureCategoryTopics(
  supabase: ReturnType<typeof createSupabaseClient>,
  categories: string[],
  createMissing: boolean,
) {
  const uniqueCategories = [...new Set(categories)];

  if (createMissing) {
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
  }

  const { data, error } = await supabase
    .from("taxonomy_topics")
    .select("id, arxiv_category")
    .in("arxiv_category", uniqueCategories);

  if (error) {
    throw error;
  }

  return new Map(
    (data ?? [])
      .filter((topic) => topic.arxiv_category)
      .map((topic) => [topic.arxiv_category as string, topic.id as string]),
  );
}

async function findExistingPaper(
  supabase: ReturnType<typeof createSupabaseClient>,
  paper: S2Paper,
) {
  const probes = [
    ["semantic_scholar_id", paper.paperId],
    ["arxiv_id", normalizeArxivId(paper.externalIds?.ArXiv)],
    ["doi", normalizeDoi(paper.externalIds?.DOI)],
  ] as const;

  for (const [column, value] of probes) {
    if (!value) {
      continue;
    }

    const { data, error } = await supabase
      .from("papers")
      .select(EXISTING_PAPER_SELECT)
      .eq(column, value)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data) {
      return data as ExistingPaper;
    }
  }

  const title = paper.title?.trim();
  const fingerprint = titleFingerprint(title);

  if (!title || !fingerprint) {
    return null;
  }

  const { data, error } = await supabase
    .from("papers")
    .select(EXISTING_PAPER_SELECT)
    .ilike("title", title)
    .limit(10);

  if (error) {
    throw error;
  }

  return (
    (data ?? []).find((existing) => titleFingerprint(existing.title) === fingerprint) ??
    null
  ) as ExistingPaper | null;
}

function plannedCandidate(
  profile: DiscoveryProfile,
  action: "insert" | "skip_new_cap" | "update",
  paper: S2Paper,
) {
  return {
    area: profile.areaLabel,
    category: profile.category,
    query: profile.query,
    action,
    title: paper.title,
    citationCount: paper.citationCount ?? 0,
    year: paper.year ?? null,
  };
}

async function writeExternalIds(
  supabase: ReturnType<typeof createSupabaseClient>,
  paperId: string,
  paper: S2Paper,
) {
  const arxivId = normalizeArxivId(paper.externalIds?.ArXiv);
  const doi = normalizeDoi(paper.externalIds?.DOI);
  const rows = [
    {
      paper_id: paperId,
      provider: "semantic_scholar",
      external_id: paper.paperId,
      url: paper.url ?? `https://www.semanticscholar.org/paper/${paper.paperId}`,
    },
    arxivId
      ? {
          paper_id: paperId,
          provider: "arxiv",
          external_id: arxivId,
          url: `https://arxiv.org/abs/${arxivId}`,
        }
      : null,
    doi
      ? {
          paper_id: paperId,
          provider: "doi",
          external_id: doi,
          url: `https://doi.org/${doi}`,
        }
      : null,
  ].filter((row): row is NonNullable<typeof row> => Boolean(row));

  const { error } = await supabase
    .from("paper_external_ids")
    .upsert(rows, { onConflict: "paper_id,provider,external_id" });

  if (error) {
    throw error;
  }
}

async function writeAuthors(
  supabase: ReturnType<typeof createSupabaseClient>,
  paperId: string,
  authors: string[],
) {
  if (!authors.length) {
    return;
  }

  const { error: deleteError } = await supabase
    .from("paper_authors")
    .delete()
    .eq("paper_id", paperId);

  if (deleteError) {
    throw deleteError;
  }

  const { error } = await supabase.from("paper_authors").insert(
    authors.map((name, position) => ({
      paper_id: paperId,
      name,
      position,
    })),
  );

  if (error) {
    throw error;
  }
}

async function writeTopics(
  supabase: ReturnType<typeof createSupabaseClient>,
  paperId: string,
  profile: DiscoveryProfile,
  topicIdsByCategory: Map<string, string>,
) {
  const rows = profile.topics
    .map((category) => topicIdsByCategory.get(category))
    .filter((topicId): topicId is string => Boolean(topicId))
    .map((topicId) => ({
      paper_id: paperId,
      topic_id: topicId,
      confidence: 0.85,
      source: "classic_discovery",
    }));

  if (!rows.length) {
    return;
  }

  const { error } = await supabase
    .from("paper_topics")
    .upsert(rows, { onConflict: "paper_id,topic_id", ignoreDuplicates: true });

  if (error) {
    throw error;
  }
}

async function upsertPaper(
  supabase: ReturnType<typeof createSupabaseClient>,
  paper: S2Paper,
  profile: DiscoveryProfile,
  topicIdsByCategory: Map<string, string>,
) {
  const existing = await findExistingPaper(supabase, paper);
  const arxivId = normalizeArxivId(paper.externalIds?.ArXiv);
  const doi = normalizeDoi(paper.externalIds?.DOI);
  const pdfUrl = paperPdfUrl(paper);
  const payload = {
    title: paper.title ?? "Untitled discovered classic",
    abstract: paper.abstract?.trim() || existing?.abstract || null,
    year: paper.year ?? existing?.year ?? null,
    published_at: paper.publicationDate ?? existing?.published_at ?? null,
    source: existing?.source ?? sourceForPaper(paper),
    doi: doi ?? existing?.doi ?? null,
    arxiv_id: arxivId ?? existing?.arxiv_id ?? null,
    semantic_scholar_id: paper.paperId,
    url: paperUrl(paper),
    pdf_url: pdfUrl ?? existing?.pdf_url ?? null,
    venue: paper.venue?.trim() || existing?.venue || null,
    citation_count: paper.citationCount ?? existing?.citation_count ?? null,
    is_open_access: Boolean(arxivId || pdfUrl || existing?.is_open_access),
    access: arxivId || pdfUrl ? "open" : existing?.access ?? "unknown",
    is_classic: true,
  };
  const { data: saved, error } = existing
    ? await supabase
        .from("papers")
        .update(payload)
        .eq("id", existing.id)
        .select("id")
        .single()
    : await supabase.from("papers").insert(payload).select("id").single();

  if (error) {
    throw error;
  }

  const paperId = saved.id as string;

  await writeExternalIds(supabase, paperId, paper);
  await writeAuthors(supabase, paperId, paperAuthors(paper));
  await writeTopics(supabase, paperId, profile, topicIdsByCategory);

  return existing ? "updated" : "inserted";
}

async function main() {
  loadLocalEnv();
  const config = parseArgs();
  const supabase = createSupabaseClient();
  const areas = discoveryAreasFor(config);
  const profiles = discoveryProfilesFor(areas, config);

  if (!profiles.length) {
    throw new Error("No classic discovery profiles matched the selected categories or queries");
  }

  const selectedAreas = discoveryAreaSummaries(profiles);
  const topicIdsByCategory = await ensureCategoryTopics(
    supabase,
    profiles.flatMap((profile) => profile.topics),
    !config.dryRun,
  );
  const planned = [];
  let inserted = 0;
  let updated = 0;
  let existingCandidates = 0;

  for (const [index, profile] of profiles.entries()) {
    if (index > 0) {
      await sleep(config.requestDelayMs);
    }

    const candidates = await fetchSemanticScholarCandidates(profile, config);
    let newForProfile = 0;

    for (const paper of candidates) {
      const existing = await findExistingPaper(supabase, paper);
      const action = existing ? "update" : "insert";

      if (!existing && newForProfile >= config.maxNewPerQuery) {
        planned.push(plannedCandidate(profile, "skip_new_cap", paper));
        continue;
      }

      planned.push(plannedCandidate(profile, action, paper));

      if (existing) {
        existingCandidates++;
      } else {
        newForProfile++;
      }

      if (config.dryRun) {
        continue;
      }

      const result = await upsertPaper(supabase, paper, profile, topicIdsByCategory);

      if (result === "inserted") {
        inserted++;
      } else {
        updated++;
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: config.dryRun ? "dry-run" : "write",
        source: "semantic_scholar",
        areas: selectedAreas.length,
        profiles: profiles.length,
        selectedAreas,
        perQuery: config.perQuery,
        maxNewPerQuery: config.maxNewPerQuery,
        maxYear: config.maxYear,
        inserted,
        updated,
        existingCandidates,
        planned,
      },
      null,
      2,
    ),
  );
}

void main();
