import "server-only";

import { mockPapers, topicTree } from "@/lib/mock-data";
import {
  paperSourceFromDatabase,
  paperSourceToDatabase,
} from "@/lib/paper-sources";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Tables, TablesInsert } from "@/types/database";
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

const paperIdentities: Record<
  string,
  { column: "arxiv_id" | "semantic_scholar_id" | "openalex_id"; value: string }
> = {
  "paper-001": { column: "arxiv_id", value: "paperdeck-seed-001" },
  "paper-002": {
    column: "semantic_scholar_id",
    value: "paperdeck-seed-002",
  },
  "paper-003": { column: "openalex_id", value: "paperdeck-seed-003" },
  "paper-004": { column: "arxiv_id", value: "paperdeck-seed-004" },
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

function topicDepth(slug: string): number {
  const topic = topicTree.find((item) => item.id === slug);

  if (!topic?.parentId) {
    return 0;
  }

  return topicDepth(topic.parentId) + 1;
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

export async function ensureSeedCatalog() {
  const supabase = createServiceRoleClient();
  const sortedTopics = [...topicTree].sort(
    (a, b) => topicDepth(a.id) - topicDepth(b.id),
  );
  const topicIdsBySlug = new Map<string, string>();

  for (const [index, topic] of sortedTopics.entries()) {
    const parentId = topic.parentId ? topicIdsBySlug.get(topic.parentId) : null;

    const { data, error } = await supabase
      .from("taxonomy_topics")
      .upsert(
        {
          slug: topic.id,
          label: topic.label,
          parent_id: parentId ?? null,
          source: "paperdeck_seed",
          arxiv_category: topic.arxivCategory ?? null,
          depth: topicDepth(topic.id),
          sort_order: index,
        },
        { onConflict: "slug" },
      )
      .select("id, slug")
      .single();

    assertNoError(error, `Seed topic ${topic.id}`);
    if (!data) {
      throw new Error(`Seed topic ${topic.id}: missing saved row`);
    }

    topicIdsBySlug.set(data.slug, data.id);
  }

  for (const paper of mockPapers) {
    const identity = paperIdentities[paper.id];

    if (!identity) {
      throw new Error(`Missing seed identity for ${paper.id}`);
    }

    const paperPayload: TablesInsert<"papers"> = {
      title: paper.title,
      abstract: paper.abstract,
      year: paper.year,
      source: paperSourceToDatabase(paper.source),
      url: paper.url,
      pdf_url: paper.pdfUrl ?? null,
      venue: paper.venue ?? null,
      citation_count: paper.citationCount ?? null,
      is_open_access: paper.access === "open",
      access: paper.access,
      is_classic: paper.isClassic ?? false,
      [identity.column]: identity.value,
    };

    const { data: existingPaper, error: lookupError } = await supabase
      .from("papers")
      .select("id")
      .eq(identity.column, identity.value)
      .maybeSingle();

    assertNoError(lookupError, `Find seed paper ${paper.id}`);

    const { data: savedPaper, error: saveError } = existingPaper
      ? await supabase
          .from("papers")
          .update(paperPayload)
          .eq("id", existingPaper.id)
          .select("id")
          .single()
      : await supabase
          .from("papers")
          .insert(paperPayload)
          .select("id")
          .single();

    assertNoError(saveError, `Save seed paper ${paper.id}`);
    if (!savedPaper) {
      throw new Error(`Save seed paper ${paper.id}: missing saved row`);
    }

    const authorRows = paper.authors.map((name, position) => ({
      paper_id: savedPaper.id,
      name,
      position,
    }));

    const { error: authorError } = await supabase
      .from("paper_authors")
      .upsert(authorRows, { onConflict: "paper_id,position" });

    assertNoError(authorError, `Seed authors for ${paper.id}`);

    const paperTopicRows = paper.topics.map((topic) => {
      const topicId = topicIdsBySlug.get(topic.id);

      if (!topicId) {
        throw new Error(`Missing seeded topic for ${topic.id}`);
      }

      return {
        paper_id: savedPaper.id,
        topic_id: topicId,
        confidence: 1,
        source: "paperdeck_seed",
      };
    });

    const { error: paperTopicError } = await supabase
      .from("paper_topics")
      .upsert(paperTopicRows, { onConflict: "paper_id,topic_id" });

    assertNoError(paperTopicError, `Seed topics for ${paper.id}`);
  }
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
