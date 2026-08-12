import { performance } from "node:perf_hooks";
import { loadEnvConfig } from "@next/env";
import pg from "pg";
import postgres from "postgres";
import { assertDisposableLocalDatabase } from "./local-database";

loadEnvConfig(process.cwd());

const DEFAULT_BENCHMARK_DATABASE_URL =
  "postgresql://paperdeck:paperdeck_local_only@127.0.0.1:55432/paperdeck_test";
const databaseUrl =
  process.env.PAPERDECK_TEST_DATABASE_URL ?? DEFAULT_BENCHMARK_DATABASE_URL;
assertDisposableLocalDatabase(databaseUrl, "paperdeck_test");
process.env.DATABASE_URL = databaseUrl;

type CapturedQuery = { text: string; values: unknown[] };
type ExplainPlan = {
  "Execution Time": number;
  Plan: PlanNode;
  "Planning Time": number;
};
type PlanNode = {
  "Actual Rows"?: number;
  "Index Name"?: string;
  "Node Type": string;
  Plans?: PlanNode[];
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
};

let capturedCandidateQuery: CapturedQuery | null = null;
const poolPrototype = pg.Pool.prototype as unknown as {
  query: (...args: unknown[]) => unknown;
};
const originalPoolQuery = poolPrototype.query;
poolPrototype.query = function captureCatalogQuery(...args: unknown[]) {
  const first = args[0];
  const text =
    typeof first === "string"
      ? first
      : first && typeof first === "object" && "text" in first
        ? String((first as { text: unknown }).text)
        : "";
  if (text.includes("candidate_matches as materialized")) {
    const configValues =
      first && typeof first === "object" && "values" in first
        ? (first as { values?: unknown[] }).values
        : undefined;
    capturedCandidateQuery = {
      text,
      values: configValues ?? (Array.isArray(args[1]) ? args[1] : []),
    };
  }
  return originalPoolQuery.apply(this, args);
};

const sql = postgres(databaseUrl, { max: 4, prepare: false });
const benchmarkSource = "catalog-search-benchmark";
const benchmarkTopicId = "17600000-0000-4000-8000-000000000176";
const runsPerQuery = 10;
const scaleTargets = [3_000, 30_000, 300_000];

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function rounded(value: number) {
  return Number(value.toFixed(2));
}

function collectPlanEvidence(node: PlanNode) {
  const indexNames = new Set<string>();
  const nodeTypes = new Set<string>();
  let sharedHitBlocks = 0;
  let sharedReadBlocks = 0;

  function visit(current: PlanNode) {
    nodeTypes.add(current["Node Type"]);
    if (current["Index Name"]) indexNames.add(current["Index Name"]);
    sharedHitBlocks += current["Shared Hit Blocks"] ?? 0;
    sharedReadBlocks += current["Shared Read Blocks"] ?? 0;
    current.Plans?.forEach(visit);
  }
  visit(node);

  return {
    indexNames: [...indexNames].sort(),
    nodeTypes: [...nodeTypes].sort(),
    sharedHitBlocks,
    sharedReadBlocks,
  };
}

async function cleanupFixtures() {
  await sql`delete from taxonomy_topics where id = ${benchmarkTopicId}::uuid`;
  await sql`
    delete from papers
    where url like 'https://example.invalid/catalog-search-benchmark/%'
  `;
}

async function seedTopic() {
  await sql`
    insert into taxonomy_topics (
      id, slug, label, source, depth, sort_order
    ) values (
      ${benchmarkTopicId}::uuid,
      'index-target-topic-176',
      'IndexTargetTopic176',
      ${benchmarkSource},
      0,
      176
    )
  `;
}

async function seedTo(previousCount: number, paperCount: number) {
  const start = previousCount + 1;
  await sql`
    insert into papers (
      id,
      title,
      abstract,
      year,
      source,
      arxiv_id,
      doi,
      url,
      access
    )
    select
      ('17600000-0000-4000-8000-' || lpad(item::text, 12, '0'))::uuid,
      concat_ws(
        ' ',
        'Synthetic catalog benchmark paper',
        item,
        case when item <= 2500 then 'DeepCursorTarget176' end,
        case when item % 100 = 0 then 'IndexTargetTitle176' end
      ),
      'Compact synthetic catalog-search benchmark abstract.',
      case when item % 17 = 0 then null else 2026 - (item % 12) end,
      'manual'::paper_source,
      '2608.' || lpad(item::text, 6, '0'),
      '10.176/benchmark.' || lpad(item::text, 6, '0'),
      'https://example.invalid/catalog-search-benchmark/' || item,
      'open'::paper_access
    from generate_series(${start}::integer, ${paperCount}::integer) as item
  `;
  await sql`
    insert into paper_authors (paper_id, name, position)
    select
      ('17600000-0000-4000-8000-' || lpad(item::text, 12, '0'))::uuid,
      case
        when item % 100 = 0 then 'IndexTargetAuthor176 ' || item
        else 'Synthetic Benchmark Author ' || item
      end,
      0
    from generate_series(${start}::integer, ${paperCount}::integer) as item
  `;
  await sql`
    insert into paper_topics (paper_id, topic_id, confidence, source)
    select
      ('17600000-0000-4000-8000-' || lpad(item::text, 12, '0'))::uuid,
      ${benchmarkTopicId}::uuid,
      1,
      ${benchmarkSource}
    from generate_series(${start}::integer, ${paperCount}::integer) as item
    where item % 100 = 0
  `;
  await sql`analyze papers`;
  await sql`analyze paper_authors`;
  await sql`analyze paper_topics`;
  await sql`analyze taxonomy_topics`;
}

async function explainCapturedQuery() {
  const captured = capturedCandidateQuery as CapturedQuery | null;
  if (!captured) throw new Error("The catalog candidate query was not captured");
  const explained = await sql.unsafe<[{ "QUERY PLAN": ExplainPlan[] }]>(
    `explain (analyze, buffers, format json) ${captured.text}`,
    captured.values as never[],
  );
  const plan = explained[0]?.["QUERY PLAN"]?.[0];
  if (!plan) throw new Error("PostgreSQL did not return a JSON query plan");
  return { ...collectPlanEvidence(plan.Plan), plan };
}

async function benchmarkQuery(
  searchPapers: typeof import("../src/lib/repositories/catalog")["searchPapers"],
  query: string,
  expectedIndex: string | null,
  requireIndex: boolean,
) {
  capturedCandidateQuery = null;
  const warm = await searchPapers(query);
  if (!warm.results.length) {
    const direct = await sql<{ identifiers: number }[]>`
      select count(*)::integer as identifiers
      from papers
      where arxiv_id ilike ${`%${query}%`} or doi ilike ${`%${query}%`}
    `;
    throw new Error(
      `Benchmark query returned no results: ${query}; direct identifiers=${direct[0]?.identifiers ?? 0}`,
    );
  }
  const explanation = await explainCapturedQuery();
  if (
    requireIndex &&
    expectedIndex &&
    !explanation.indexNames.includes(expectedIndex)
  ) {
    throw new Error(
      `${query} did not use ${expectedIndex}; used ${explanation.indexNames.join(", ")}`,
    );
  }

  const durations: number[] = [];
  let responseBytes = 0;
  for (let run = 0; run < runsPerQuery; run += 1) {
    const startedAt = performance.now();
    const result = await searchPapers(query);
    durations.push(performance.now() - startedAt);
    responseBytes = Buffer.byteLength(JSON.stringify(result));
  }

  return {
    expectedIndex,
    indexNames: explanation.indexNames,
    nodeTypes: explanation.nodeTypes,
    planExecutionMs: rounded(explanation.plan["Execution Time"]),
    planPlanningMs: rounded(explanation.plan["Planning Time"]),
    query,
    repositoryP50Ms: rounded(percentile(durations, 0.5)),
    repositoryP95Ms: rounded(percentile(durations, 0.95)),
    responseBytes,
    sharedHitBlocks: explanation.sharedHitBlocks,
    sharedReadBlocks: explanation.sharedReadBlocks,
  };
}

async function benchmarkDeepCursor(
  searchPapers: typeof import("../src/lib/repositories/catalog")["searchPapers"],
) {
  const query = "DeepCursorTarget176";
  const firstDurations: number[] = [];
  let first = await searchPapers(query);
  for (let run = 0; run < runsPerQuery; run += 1) {
    const startedAt = performance.now();
    first = await searchPapers(query);
    firstDurations.push(performance.now() - startedAt);
  }

  let page = first;
  for (let pageNumber = 2; pageNumber <= 100; pageNumber += 1) {
    if (!page.nextCursor) {
      throw new Error(`Deep cursor ended before page ${pageNumber}`);
    }
    page = await searchPapers(query, page.nextCursor);
  }
  const page100Cursor = page.previousCursor
    ? (await searchPapers(query, page.previousCursor)).nextCursor
    : null;
  if (!page100Cursor) throw new Error("Could not reconstruct page 100 cursor");

  const deepDurations: number[] = [];
  for (let run = 0; run < runsPerQuery; run += 1) {
    const startedAt = performance.now();
    const deepPage = await searchPapers(query, page100Cursor);
    deepDurations.push(performance.now() - startedAt);
    if (deepPage.page !== 100) {
      throw new Error(`Expected page 100, received ${deepPage.page}`);
    }
  }

  return {
    page1P95Ms: rounded(percentile(firstDurations, 0.95)),
    page100P95Ms: rounded(percentile(deepDurations, 0.95)),
    query,
  };
}

async function main() {
  try {
    await cleanupFixtures();
    await seedTopic();
    const { searchPapers } = await import(
      "../src/lib/repositories/catalog"
    );
    const results = [];
    let previousCount = 0;

    for (const paperCount of scaleTargets) {
      await seedTo(previousCount, paperCount);
      previousCount = paperCount;
      const queryResults = [];
      for (const [query, expectedIndex] of [
        ["IndexTargetTitle176", "papers_title_trgm_idx"],
        ["IndexTargetAuthor176", "paper_authors_name_trgm_idx"],
        [
          `10.176/benchmark.${Math.floor(paperCount / 2).toString().padStart(6, "0")}`,
          "papers_doi_trgm_idx",
        ],
        [
          `2608.${Math.floor(paperCount / 2).toString().padStart(6, "0")}`,
          "papers_arxiv_id_trgm_idx",
        ],
        ["IndexTargetTopic176", null],
      ] as const) {
        queryResults.push(
          await benchmarkQuery(
            searchPapers,
            query,
            expectedIndex,
            paperCount >= 300_000,
          ),
        );
      }
      results.push({
        deepCursor: await benchmarkDeepCursor(searchPapers),
        paperCount,
        queries: queryResults,
        runsPerQuery,
      });
    }

    process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
  } finally {
    capturedCandidateQuery = null;
    await cleanupFixtures();
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
