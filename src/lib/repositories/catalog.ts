import "server-only";

import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { papers, paperAuthors, paperTopics, taxonomyTopics } from "@/db/schema";
import { topicDisplayLabel } from "@/lib/arxiv-categories";
import { paperSourceFromDatabase } from "@/lib/paper-sources";
import {
  SEARCH_PAGE_SIZE,
  decodeCatalogSearchCursor,
  encodeCatalogSearchCursor,
} from "@/lib/repositories/catalog-search";
import { PaperAccessSchema, TriageSummarySchema } from "@/lib/schemas/paper-access";
import { INITIAL_FEED_RECOMMENDATION_COUNT } from "@/lib/recommendation-batches";
import type { Paper, PaperTopic } from "@/types/paper";

type PaperRow = typeof papers.$inferSelect;

type TopicRow = typeof taxonomyTopics.$inferSelect;

export type PaperPresentationRow = Pick<
  PaperRow,
  | "id"
  | "title"
  | "abstract"
  | "year"
  | "source"
  | "url"
  | "pdfUrl"
  | "venue"
  | "doi"
  | "citationCount"
  | "isClassic"
  | "access"
  | "triageSummary"
>;

export type PaperPresentationTopic = Pick<
  TopicRow,
  "id" | "label" | "parentId" | "arxivCategory"
>;

const SEARCH_QUERY_MAX_LENGTH = 120;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const CATALOG_RANKING_CANDIDATE_LIMIT = 300;

const paperPresentationSelection = {
  id: papers.id,
  title: papers.title,
  abstract: papers.abstract,
  year: papers.year,
  source: papers.source,
  url: papers.url,
  pdfUrl: papers.pdfUrl,
  venue: papers.venue,
  doi: papers.doi,
  citationCount: papers.citationCount,
  isClassic: papers.isClassic,
  access: papers.access,
  triageSummary: papers.triageSummary,
};

const paperPresentationTopicSelection = {
  id: taxonomyTopics.id,
  label: taxonomyTopics.label,
  parentId: taxonomyTopics.parentId,
  arxivCategory: taxonomyTopics.arxivCategory,
};

const paperRankingSelection = {
  id: papers.id,
  year: papers.year,
  citationCount: papers.citationCount,
  isClassic: papers.isClassic,
};

export type CatalogRankingCandidate = {
  id: string;
  year: number | null;
  citationCount: number | null;
  isClassic: boolean;
  topicIds: string[];
};

export { SEARCH_PAGE_SIZE };

export type SearchPapersResult = {
  results: Awaited<ReturnType<typeof getPapersByIds>>;
  nextCursor: string | null;
  page: number;
  previousCursor: string | null;
};

function topicFromRow(row: PaperPresentationTopic): PaperTopic {
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
  row: PaperPresentationRow,
  authors: string[] = [],
  topics: PaperPresentationTopic[] = [],
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
  const validPaperIds = paperIds.filter((paperId) => uuidPattern.test(paperId));

  if (!validPaperIds.length) {
    return [];
  }

  const paperRows = await db
    .select(paperPresentationSelection)
    .from(papers)
    .where(inArray(papers.id, validPaperIds));

  if (!paperRows.length) {
    return [];
  }

  const paperIdsFound = paperRows.map((p) => p.id);

  const authorRows = await db
    .select({
      paperId: paperAuthors.paperId,
      name: paperAuthors.name,
      position: paperAuthors.position,
    })
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
      topic: paperPresentationTopicSelection,
    })
    .from(paperTopics)
    .leftJoin(taxonomyTopics, eq(paperTopics.topicId, taxonomyTopics.id))
    .where(inArray(paperTopics.paperId, paperIdsFound));

  const topicsByPaper = new Map<string, PaperPresentationTopic[]>();
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
export async function getRankingCandidatesByIds(
  paperIds: string[],
): Promise<CatalogRankingCandidate[]> {
  const validPaperIds = [
    ...new Set(paperIds.filter((paperId) => uuidPattern.test(paperId))),
  ];

  if (!validPaperIds.length) return [];

  const [paperRows, topicRows] = await Promise.all([
    db
      .select(paperRankingSelection)
      .from(papers)
      .where(inArray(papers.id, validPaperIds)),
    db
      .select({ paperId: paperTopics.paperId, topicId: paperTopics.topicId })
      .from(paperTopics)
      .where(inArray(paperTopics.paperId, validPaperIds)),
  ]);

  const topicIdsByPaper = new Map<string, string[]>();
  for (const row of topicRows) {
    const topicIds = topicIdsByPaper.get(row.paperId) ?? [];
    topicIds.push(row.topicId);
    topicIdsByPaper.set(row.paperId, topicIds);
  }

  const candidatesById = new Map(
    paperRows.map((row) => [
      row.id,
      { ...row, topicIds: topicIdsByPaper.get(row.id) ?? [] },
    ]),
  );

  return validPaperIds.flatMap((paperId) => {
    const candidate = candidatesById.get(paperId);
    return candidate ? [candidate] : [];
  });
}

type CatalogCandidateQueryRow = {
  id: string;
  year: number | null;
  citation_count: number | null;
  is_classic: boolean;
  topic_id: string | null;
};

function uuidSqlArray(values: string[]) {
  const validValues = [...new Set(values.filter((value) => uuidPattern.test(value)))];

  if (!validValues.length) return sql`array[]::uuid[]`;

  return sql`array[${sql.join(
    validValues.map((value) => sql`${value}::uuid`),
    sql`, `,
  )}]::uuid[]`;
}

function topicWeightSqlRows(topicWeights: Map<string, number>) {
  const validEntries = [...topicWeights]
    .filter(([topicId, weight]) => uuidPattern.test(topicId) && Number.isFinite(weight));

  if (!validEntries.length) {
    return sql`select null::uuid as topic_id, null::real as weight where false`;
  }

  return sql`values ${sql.join(
    validEntries.map(
      ([topicId, weight]) => sql`(${topicId}::uuid, ${weight}::real)`,
    ),
    sql`, `,
  )}`;
}

/** @admin */
export async function getCatalogRankingCandidates({
  excludedPaperIds,
  topicWeights,
  limit = CATALOG_RANKING_CANDIDATE_LIMIT,
}: {
  excludedPaperIds: string[];
  topicWeights: Map<string, number>;
  limit?: number;
}): Promise<CatalogRankingCandidate[]> {
  const boundedLimit = Math.min(
    Math.max(Math.trunc(limit), INITIAL_FEED_RECOMMENDATION_COUNT),
    500,
  );
  const topicLimit = Math.ceil(boundedLimit * 0.5);
  const recentLimit = Math.ceil(boundedLimit * 0.35);
  const citedLimit = Math.ceil(boundedLimit * 0.25);
  const classicLimit = Math.ceil(boundedLimit * 0.1);
  const excludedIds = uuidSqlArray(excludedPaperIds);
  const weightedTopics = topicWeightSqlRows(topicWeights);

  const result = await db.execute<CatalogCandidateQueryRow>(sql`
    with topic_weights(topic_id, weight) as (${weightedTopics}),
    personalized_candidates as (
      select p.id, p.year, p.citation_count,
        sum(weights.weight) + ln(1 + greatest(coalesce(p.citation_count, 0), 0)) * 2
          + greatest(0, coalesce(p.year, 2020) - 2020) * 0.4
          + case when p.is_classic then 2 else 0 end as candidate_score
      from ${papers} p
      join ${paperTopics} pt on pt.paper_id = p.id
      join topic_weights weights on weights.topic_id = pt.topic_id
      where not (p.id = any(${excludedIds}))
      group by p.id, p.year, p.citation_count, p.is_classic
      having sum(weights.weight) > 0
      order by candidate_score desc, p.id
      limit ${topicLimit}
    ),
    recent_candidates as (
      select p.id, p.year, p.citation_count,
        ln(1 + greatest(coalesce(p.citation_count, 0), 0)) * 2
          + greatest(0, coalesce(p.year, 2020) - 2020) * 0.4
          + case when p.is_classic then 2 else 0 end as candidate_score
      from ${papers} p
      where not (p.id = any(${excludedIds}))
      order by p.year desc nulls last, p.published_at desc nulls last, p.id
      limit ${recentLimit}
    ),
    cited_candidates as (
      select p.id, p.year, p.citation_count,
        ln(1 + greatest(coalesce(p.citation_count, 0), 0)) * 2
          + greatest(0, coalesce(p.year, 2020) - 2020) * 0.4
          + case when p.is_classic then 2 else 0 end as candidate_score
      from ${papers} p
      where not (p.id = any(${excludedIds}))
      order by p.citation_count desc nulls last, p.year desc nulls last, p.id
      limit ${citedLimit}
    ),
    classic_candidates as (
      select p.id, p.year, p.citation_count,
        ln(1 + greatest(coalesce(p.citation_count, 0), 0)) * 2
          + greatest(0, coalesce(p.year, 2020) - 2020) * 0.4
          + 2 as candidate_score
      from ${papers} p
      where p.is_classic
        and not (p.id = any(${excludedIds}))
      order by p.citation_count desc nulls last, p.year desc nulls last, p.id
      limit ${classicLimit}
    ),
    union_candidates as (
      select * from personalized_candidates
      union all
      select * from recent_candidates
      union all
      select * from cited_candidates
      union all
      select * from classic_candidates
    ),
    selected_candidates as (
      select id, max(candidate_score) as candidate_score, max(year) as year,
        max(citation_count) as citation_count
      from union_candidates
      group by id
      order by candidate_score desc, year desc nulls last,
        citation_count desc nulls last, id
      limit ${boundedLimit}
    )
    select p.id, p.year, p.citation_count, p.is_classic, pt.topic_id
    from selected_candidates selected
    join ${papers} p on p.id = selected.id
    left join ${paperTopics} pt on pt.paper_id = p.id
    order by selected.candidate_score desc, selected.year desc nulls last,
      selected.citation_count desc nulls last, p.id, pt.topic_id
  `);

  const candidatesById = new Map<string, CatalogRankingCandidate>();
  for (const row of result.rows) {
    const candidate = candidatesById.get(row.id) ?? {
      id: row.id,
      year: row.year,
      citationCount: row.citation_count,
      isClassic: row.is_classic,
      topicIds: [],
    };
    if (row.topic_id) candidate.topicIds.push(row.topic_id);
    candidatesById.set(row.id, candidate);
  }

  return [...candidatesById.values()];
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
  encodedCursor?: string | null,
): Promise<SearchPapersResult> {
  const normalizedQuery = normalizeCatalogSearchQuery(query);
  const cursor = decodeCatalogSearchCursor(encodedCursor, normalizedQuery);

  if (normalizedQuery.length < 2) {
    return {
      results: [],
      nextCursor: null,
      page: 1,
      previousCursor: null,
    };
  }

  const pattern = `%${normalizedQuery}%`;
  const tsquery = sql`plainto_tsquery('english', ${normalizedQuery})`;
  const boundary = cursor
    ? cursor.direction === "next"
      ? sql`where
          scored.rank < ${cursor.rank}::real
          or (
            scored.rank = ${cursor.rank}::real
            and ${
              cursor.year === null
                ? sql`scored.year is null and scored.id > ${cursor.id}::uuid`
                : sql`(
                    scored.year < ${cursor.year}
                    or scored.year is null
                    or (
                      scored.year = ${cursor.year}
                      and scored.id > ${cursor.id}::uuid
                    )
                  )`
            }
          )`
      : sql`where
          scored.rank > ${cursor.rank}::real
          or (
            scored.rank = ${cursor.rank}::real
            and ${
              cursor.year === null
                ? sql`scored.year is not null or (
                    scored.year is null and scored.id < ${cursor.id}::uuid
                  )`
                : sql`scored.year > ${cursor.year} or (
                    scored.year = ${cursor.year}
                    and scored.id < ${cursor.id}::uuid
                  )`
            }
          )`
    : sql``;
  const ordering = cursor?.direction === "previous"
    ? sql`scored.rank, scored.year nulls first, scored.id desc`
    : sql`scored.rank desc, scored.year desc nulls last, scored.id`;

  const result = await db.execute<{
    id: string;
    rank: number;
    year: number | null;
  }>(sql`
    with candidate_matches as materialized (
      select
        ${papers.id} as id,
        ${papers.year} as year,
        coalesce(ts_rank(${papers}."search_vector", ${tsquery}), 0)::real as rank
      from ${papers}
      where ${papers}."search_vector" @@ ${tsquery}
        or ${papers.title} ilike ${pattern}
        or ${papers.arxivId} ilike ${pattern}
        or ${papers.doi} ilike ${pattern}

      union all

      select ${papers.id}, ${papers.year}, 0::real
      from ${paperAuthors}
      inner join ${papers} on ${papers.id} = ${paperAuthors.paperId}
      where ${paperAuthors.name} ilike ${pattern}

      union all

      select ${papers.id}, ${papers.year}, 0::real
      from ${taxonomyTopics}
      inner join ${paperTopics}
        on ${paperTopics.topicId} = ${taxonomyTopics.id}
      inner join ${papers} on ${papers.id} = ${paperTopics.paperId}
      where ${taxonomyTopics.label} ilike ${pattern}
    ),
    scored as materialized (
      select id, year, max(rank)::real as rank
      from candidate_matches
      group by id, year
    )
    select scored.id, scored.year, scored.rank
    from scored
    ${boundary}
    order by ${ordering}
    limit ${SEARCH_PAGE_SIZE + 1}
  `);

  const hasBeyondBoundary = result.rows.length > SEARCH_PAGE_SIZE;
  const selectedRows = result.rows.slice(0, SEARCH_PAGE_SIZE);
  const pageMatches =
    cursor?.direction === "previous" ? selectedRows.reverse() : selectedRows;
  const results = await getPapersByIds(pageMatches.map((match) => match.id));
  const first = pageMatches.at(0);
  const last = pageMatches.at(-1);
  const page = cursor?.page ?? 1;
  const hasPrevious = cursor
    ? cursor.direction === "previous"
      ? hasBeyondBoundary
      : true
    : false;
  const hasNext = cursor?.direction === "previous" ? true : hasBeyondBoundary;

  return {
    results,
    nextCursor:
      hasNext && last
        ? encodeCatalogSearchCursor(
            {
              direction: "next",
              id: last.id,
              page: page + 1,
              rank: Number(last.rank),
              year: last.year,
            },
            normalizedQuery,
          )
        : null,
    page,
    previousCursor:
      hasPrevious && first
        ? encodeCatalogSearchCursor(
            {
              direction: "previous",
              id: first.id,
              page: Math.max(1, page - 1),
              rank: Number(first.rank),
              year: first.year,
            },
            normalizedQuery,
          )
        : null,
  };
}

/** @admin */
export async function getPaperById(paperId: string) {
  const paperRows = await db
    .select(paperPresentationSelection)
    .from(papers)
    .where(eq(papers.id, paperId))
    .limit(1);

  if (!paperRows.length) return null;

  const row = paperRows[0];

  const authorRows = await db
    .select({
      name: paperAuthors.name,
      position: paperAuthors.position,
    })
    .from(paperAuthors)
    .where(eq(paperAuthors.paperId, row.id))
    .orderBy(asc(paperAuthors.position));

  const topicJoinRows = await db
    .select({
      topic: paperPresentationTopicSelection,
    })
    .from(paperTopics)
    .leftJoin(taxonomyTopics, eq(paperTopics.topicId, taxonomyTopics.id))
    .where(eq(paperTopics.paperId, row.id));

  const topics = topicJoinRows
    .map((t) => t.topic)
    .filter((t): t is PaperPresentationTopic => t !== null);

  return paperFromRow(
    row,
    authorRows.map((a) => a.name),
    topics,
  );
}
