import "server-only";

import {
  paperSourceFromDatabase,
} from "@/lib/paper-sources";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";
import type { Paper, PaperAccess, PaperTopic } from "@/types/paper";

type TopicRow = Pick<
  Tables<"taxonomy_topics">,
  "id" | "slug" | "label" | "parent_id" | "arxiv_category" | "depth" | "sort_order"
>;

type PaperAuthorRow = Pick<Tables<"paper_authors">, "name" | "position">;

type PaperRow = Pick<
  Tables<"papers">,
  | "id"
  | "title"
  | "abstract"
  | "year"
  | "source"
  | "url"
  | "pdf_url"
  | "venue"
  | "citation_count"
  | "is_classic"
  | "access"
  | "triage_summary"
> & {
  paper_authors?: PaperAuthorRow[] | null;
  paper_topics?: Array<{
    taxonomy_topics: TopicRow | TopicRow[] | null;
  }> | null;
};

const paperSelectSimple = `
  id,
  title,
  abstract,
  year,
  source,
  url,
  pdf_url,
  venue,
  citation_count,
  is_classic,
  access,
  paper_authors(name, position),
  paper_topics(taxonomy_topics(id, slug, label, parent_id, arxiv_category, depth, sort_order))
`;

const paperSelectWithSummary = `
  ${paperSelectSimple.trim()},
  triage_summary
`;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertNoError(error: { message: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

function topicFromRow(row: TopicRow): PaperTopic {
  return {
    id: row.id,
    label: row.label,
    parentId: row.parent_id ?? undefined,
    arxivCategory: row.arxiv_category ?? undefined,
  };
}

function firstTopic(row: TopicRow | TopicRow[] | null | undefined) {
  if (Array.isArray(row)) {
    return row[0] ?? null;
  }

  return row ?? null;
}

export function paperFromRow(row: PaperRow): Paper {
  const authors = [...(row.paper_authors ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((author) => author.name);

  const topics = (row.paper_topics ?? [])
    .map((item) => firstTopic(item.taxonomy_topics))
    .filter((topic): topic is TopicRow => Boolean(topic))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(topicFromRow);

  return {
    id: row.id,
    title: row.title,
    authors,
    year: row.year ?? new Date().getFullYear(),
    source: paperSourceFromDatabase(row.source),
    venue: row.venue ?? undefined,
    abstract: row.abstract ?? "",
    topics,
    recommendationReason: buildRecommendationReason(topics),
    url: row.url,
    pdfUrl: row.pdf_url ?? undefined,
    citationCount: row.citation_count ?? undefined,
    isClassic: row.is_classic ?? false,
    access: row.access as PaperAccess,
    triageSummary: (row.triage_summary ?? undefined) as Paper["triageSummary"],
  };
}

function buildRecommendationReason(topics: PaperTopic[]) {
  const topicLabels = topics.slice(0, 2).map((topic) => topic.label);

  if (!topicLabels.length) {
    return "Seed paper from the initial PaperDeck catalog.";
  }

  return `Matches your ${topicLabels.join(" and ")} interests.`;
}

export async function getTopics() {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("taxonomy_topics")
    .select("id, slug, label, parent_id, arxiv_category, depth, sort_order")
    .order("depth", { ascending: true })
    .order("sort_order", { ascending: true })
    .returns<TopicRow[]>();

  assertNoError(error, "Load topics");

  return data ?? [];
}

export async function getPapersByIds(
  paperIds: string[],
  opts?: { includeSummary?: boolean },
) {
  const validPaperIds = paperIds.filter((paperId) => uuidPattern.test(paperId));

  if (!validPaperIds.length) {
    return [];
  }

  const select = opts?.includeSummary ? paperSelectWithSummary : paperSelectSimple;

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("papers")
    .select(select)
    .in("id", validPaperIds)
    .returns<PaperRow[]>();

  assertNoError(error, "Load papers by ID");

  const order = new Map(validPaperIds.map((paperId, index) => [paperId, index]));

  return (data ?? [])
    .map(paperFromRow)
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function getAllPapers() {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("papers")
    .select(paperSelectSimple)
    .order("year", { ascending: false })
    .returns<PaperRow[]>();

  assertNoError(error, "Load papers");

  return (data ?? []).map(paperFromRow);
}

export async function getPaperById(paperId: string) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("papers")
    .select(paperSelectWithSummary)
    .eq("id", paperId)
    .returns<PaperRow[]>()
    .maybeSingle();

  assertNoError(error, "Load paper");

  return data ? paperFromRow(data) : null;
}
