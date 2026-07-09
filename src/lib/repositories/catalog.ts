import "server-only";

import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { papers, paperAuthors, paperTopics, taxonomyTopics } from "@/db/schema";
import { topicDisplayLabel } from "@/lib/arxiv-categories";
import { paperSourceFromDatabase } from "@/lib/paper-sources";
import {
  SEARCH_PAGE_SIZE,
  normalizeSearchPage,
  searchPageOffset,
} from "@/lib/repositories/catalog-search";
import { PaperAccessSchema, TriageSummarySchema } from "@/lib/schemas/paper-access";
import type { Paper, PaperTopic } from "@/types/paper";

type PaperRow = typeof papers.$inferSelect;

type TopicRow = typeof taxonomyTopics.$inferSelect;

const SEARCH_QUERY_MAX_LENGTH = 120;

export { SEARCH_PAGE_SIZE };

export type SearchPapersResult = {
  results: Awaited<ReturnType<typeof getPapersByIds>>;
  page: number;
  hasMore: boolean;
};

function topicFromRow(row: TopicRow): PaperTopic {
  return {
    id: row.id,
    label: topicDisplayLabel({
      arxivCategory: row.arxivCategory,
      label: row.label,
    }),
    parentId: row.parentId ?? undefined,
    arxivCategory: row.arxivCategory ?? undefined,
  };
}

/** @admin */
export function paperFromRow(
  row: PaperRow,
  authors: string[] = [],
  topics: TopicRow[] = [],
): Paper {
  const paperTopics = topics.map(topicFromRow);

  return {
    id: row.id,
    title: row.title,
    authors,
    year: row.year ?? undefined,
    source: paperSourceFromDatabase(row.source),
    venue: row.venue ?? undefined,
    abstract: row.abstract ?? "",
    topics: paperTopics,
    recommendationReason: buildRecommendationReason(paperTopics) ?? "",
    url: row.url,
    pdfUrl: row.pdfUrl ?? undefined,
    doi: row.doi ?? undefined,
    citationCount: row.citationCount ?? undefined,
    isClassic: row.isClassic ?? false,
    access: PaperAccessSchema.parse(row.access),
    triageSummary: row.triageSummary
      ? TriageSummarySchema.parse(row.triageSummary)
      : undefined,
  };
}

function buildRecommendationReason(topics: PaperTopic[]) {
  const topicLabels = topics.slice(0, 2).map((topic) => topic.label);

  if (!topicLabels.length) {
    return undefined;
  }

  return `Matches your ${topicLabels.join(" and ")} interests.`;
}

/** @admin */
export async function getTopics() {
  return db
    .select()
    .from(taxonomyTopics)
    .orderBy(asc(taxonomyTopics.depth), asc(taxonomyTopics.sortOrder));
}

/** @admin */
export async function getPapersByIds(
  paperIds: string[],
) {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const validPaperIds = paperIds.filter((paperId) => uuidPattern.test(paperId));

  if (!validPaperIds.length) {
    return [];
  }

  const paperRows = await db
    .select()
    .from(papers)
    .where(inArray(papers.id, validPaperIds));

  if (!paperRows.length) {
    return [];
  }

  const paperIdsFound = paperRows.map((p) => p.id);

  const authorRows = await db
    .select()
    .from(paperAuthors)
    .where(inArray(paperAuthors.paperId, paperIdsFound))
    .orderBy(asc(paperAuthors.position));

  const authorsByPaper = new Map<string, string[]>();
  for (const a of authorRows) {
    const list = authorsByPaper.get(a.paperId) ?? [];
    list.push(a.name);
    authorsByPaper.set(a.paperId, list);
  }

  const topicJoinRows = await db
    .select({
      paper_id: paperTopics.paperId,
      topic_id: paperTopics.topicId,
      topic: taxonomyTopics,
    })
    .from(paperTopics)
    .leftJoin(taxonomyTopics, eq(paperTopics.topicId, taxonomyTopics.id))
    .where(inArray(paperTopics.paperId, paperIdsFound));

  const topicsByPaper = new Map<string, TopicRow[]>();
  for (const t of topicJoinRows) {
    if (!t.topic) continue;
    const list = topicsByPaper.get(t.paper_id) ?? [];
    list.push(t.topic);
    topicsByPaper.set(t.paper_id, list);
  }

  const result = await Promise.all(
    paperRows.map((row) =>
      paperFromRow(
        row,
        authorsByPaper.get(row.id) ?? [],
        topicsByPaper.get(row.id) ?? [],
      ),
    ),
  );

  const order = new Map(validPaperIds.map((paperId, index) => [paperId, index]));

  return result.sort(
    (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
  );
}

/** @admin */
export async function getAllPapers() {
  const paperRows = await db
    .select()
    .from(papers)
    .orderBy(desc(papers.year));

  if (!paperRows.length) {
    return [];
  }

  const paperIdsFound = paperRows.map((p) => p.id);

  const authorRows = await db
    .select()
    .from(paperAuthors)
    .where(inArray(paperAuthors.paperId, paperIdsFound))
    .orderBy(asc(paperAuthors.position));

  const authorsByPaper = new Map<string, string[]>();
  for (const a of authorRows) {
    const list = authorsByPaper.get(a.paperId) ?? [];
    list.push(a.name);
    authorsByPaper.set(a.paperId, list);
  }

  const topicJoinRows = await db
    .select({
      paper_id: paperTopics.paperId,
      topic_id: paperTopics.topicId,
      topic: taxonomyTopics,
    })
    .from(paperTopics)
    .leftJoin(taxonomyTopics, eq(paperTopics.topicId, taxonomyTopics.id))
    .where(inArray(paperTopics.paperId, paperIdsFound));

  const topicsByPaper = new Map<string, TopicRow[]>();
  for (const t of topicJoinRows) {
    if (!t.topic) continue;
    const list = topicsByPaper.get(t.paper_id) ?? [];
    list.push(t.topic);
    topicsByPaper.set(t.paper_id, list);
  }

  return Promise.all(
    paperRows.map((row) =>
      paperFromRow(
        row,
        authorsByPaper.get(row.id) ?? [],
        topicsByPaper.get(row.id) ?? [],
      ),
    ),
  );
}

function normalizeCatalogSearchQuery(query: string) {
  return query
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[%_]/g, "")
    .slice(0, SEARCH_QUERY_MAX_LENGTH);
}

/** @admin */
export async function searchPapers(
  query: string,
  page = 1,
): Promise<SearchPapersResult> {
  const normalizedQuery = normalizeCatalogSearchQuery(query);
  const currentPage = normalizeSearchPage(page);

  if (normalizedQuery.length < 2) {
    return { results: [], page: currentPage, hasMore: false };
  }

  const pattern = `%${normalizedQuery}%`;
  const offset = searchPageOffset(currentPage);

  const paperMatches = await db
    .select({ id: papers.id })
    .from(papers)
    .where(sql`
      ${papers.title} ilike ${pattern}
      or coalesce(${papers.abstract}, '') ilike ${pattern}
      or coalesce(${papers.venue}, '') ilike ${pattern}
      or coalesce(${papers.arxivId}, '') ilike ${pattern}
      or coalesce(${papers.doi}, '') ilike ${pattern}
      or exists (
        select 1
        from ${paperAuthors}
        where ${paperAuthors.paperId} = ${papers.id}
          and ${paperAuthors.name} ilike ${pattern}
      )
      or exists (
        select 1
        from ${paperTopics}
        join ${taxonomyTopics}
          on ${taxonomyTopics.id} = ${paperTopics.topicId}
        where ${paperTopics.paperId} = ${papers.id}
          and (
            ${taxonomyTopics.label} ilike ${pattern}
            or coalesce(${taxonomyTopics.arxivCategory}, '') ilike ${pattern}
          )
      )
    `)
    .orderBy(desc(papers.year), desc(papers.citationCount))
    .offset(offset)
    .limit(SEARCH_PAGE_SIZE + 1);

  const hasMore = paperMatches.length > SEARCH_PAGE_SIZE;
  const pageMatches = paperMatches.slice(0, SEARCH_PAGE_SIZE);
  const results = await getPapersByIds(pageMatches.map((match) => match.id));

  return { results, page: currentPage, hasMore };
}

/** @admin */
export async function getPaperById(paperId: string) {
  const paperRows = await db
    .select()
    .from(papers)
    .where(eq(papers.id, paperId))
    .limit(1);

  if (!paperRows.length) return null;

  const row = paperRows[0];

  const authorRows = await db
    .select()
    .from(paperAuthors)
    .where(eq(paperAuthors.paperId, row.id))
    .orderBy(asc(paperAuthors.position));

  const topicJoinRows = await db
    .select({
      topic: taxonomyTopics,
    })
    .from(paperTopics)
    .leftJoin(taxonomyTopics, eq(paperTopics.topicId, taxonomyTopics.id))
    .where(eq(paperTopics.paperId, row.id));

  const topics = topicJoinRows
    .map((t) => t.topic)
    .filter((t): t is TopicRow => t !== null);

  return paperFromRow(
    row,
    authorRows.map((a) => a.name),
    topics,
  );
}
