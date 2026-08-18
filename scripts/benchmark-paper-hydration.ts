import { performance } from "node:perf_hooks";
import { loadEnvConfig } from "@next/env";
import pg from "pg";
import {
  assertDisposableLocalDatabase,
  DEFAULT_TEST_DATABASE_URL,
} from "./local-database";

loadEnvConfig(process.cwd());

const databaseUrl =
  process.env.PAPERDECK_TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
assertDisposableLocalDatabase(databaseUrl, "paperdeck_test");

const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
const paperCount = 50;
const warmupRuns = 5;
const measuredRuns = 30;

type HydrationResult = {
  authorCount: number;
  topicCount: number;
};

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

async function loadPaperIds() {
  const result = await pool.query<{ id: string }>(
    "select id from papers order by id limit $1",
    [paperCount],
  );

  if (result.rows.length < paperCount) {
    throw new Error(`Paper hydration benchmark requires ${paperCount} papers`);
  }

  return result.rows.map((row) => row.id);
}

async function loadAuthors(paperIds: string[]) {
  return pool.query(
    `select paper_id, name, position
     from paper_authors
     where paper_id = any($1::uuid[])
     order by position`,
    [paperIds],
  );
}

async function loadTopics(paperIds: string[]) {
  return pool.query(
    `select paper_topic.paper_id, topic.id, topic.label,
            topic.parent_id, topic.arxiv_category
     from paper_topics as paper_topic
     left join taxonomy_topics as topic on topic.id = paper_topic.topic_id
     where paper_topic.paper_id = any($1::uuid[])`,
    [paperIds],
  );
}

async function hydrateSerial(paperIds: string[]): Promise<HydrationResult> {
  const authors = await loadAuthors(paperIds);
  const topics = await loadTopics(paperIds);
  return { authorCount: authors.rowCount ?? 0, topicCount: topics.rowCount ?? 0 };
}

async function hydrateParallel(paperIds: string[]): Promise<HydrationResult> {
  const [authors, topics] = await Promise.all([
    loadAuthors(paperIds),
    loadTopics(paperIds),
  ]);
  return { authorCount: authors.rowCount ?? 0, topicCount: topics.rowCount ?? 0 };
}

async function measurePair(paperIds: string[]) {
  const serialDurations: number[] = [];
  const parallelDurations: number[] = [];
  let expected: HydrationResult | null = null;

  for (let index = 0; index < warmupRuns + measuredRuns; index += 1) {
    const scenarios =
      index % 2 === 0
        ? [
            ["serial", hydrateSerial],
            ["parallel", hydrateParallel],
          ] as const
        : [
            ["parallel", hydrateParallel],
            ["serial", hydrateSerial],
          ] as const;

    for (const [name, hydrate] of scenarios) {
      const startedAt = performance.now();
      const result = await hydrate(paperIds);
      const duration = performance.now() - startedAt;

      expected ??= result;
      if (
        result.authorCount !== expected.authorCount ||
        result.topicCount !== expected.topicCount
      ) {
        throw new Error("Hydration row counts changed during the benchmark");
      }
      if (index >= warmupRuns) {
        (name === "serial" ? serialDurations : parallelDurations).push(duration);
      }
    }
  }

  return {
    serial: {
      p50Ms: Number(percentile(serialDurations, 0.5).toFixed(2)),
      p95Ms: Number(percentile(serialDurations, 0.95).toFixed(2)),
      rows: expected,
      runs: measuredRuns,
    },
    parallel: {
      p50Ms: Number(percentile(parallelDurations, 0.5).toFixed(2)),
      p95Ms: Number(percentile(parallelDurations, 0.95).toFixed(2)),
      rows: expected,
      runs: measuredRuns,
    },
  };
}

async function main() {
  try {
    const paperIds = await loadPaperIds();
    const { serial, parallel } = await measurePair(paperIds);

    console.log(
      JSON.stringify({
        paperCount,
        poolMaxConnections: 3,
        serial,
        parallel,
        p50ImprovementPercent: Number(
          (((serial.p50Ms - parallel.p50Ms) / serial.p50Ms) * 100).toFixed(1),
        ),
        p95ImprovementPercent: Number(
          (((serial.p95Ms - parallel.p95Ms) / serial.p95Ms) * 100).toFixed(1),
        ),
      }),
    );
  } finally {
    await pool.end();
  }
}

void main();
