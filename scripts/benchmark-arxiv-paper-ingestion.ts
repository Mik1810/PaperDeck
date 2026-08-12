import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { loadEnvConfig } from "@next/env";
import postgres from "postgres";
import { mapWithConcurrency } from "./lib/arxiv-ingestion";
import {
  assertDisposableLocalDatabase,
  DEFAULT_TEST_DATABASE_URL,
} from "./local-database";

loadEnvConfig(process.cwd());

const databaseUrl =
  process.env.PAPERDECK_TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
assertDisposableLocalDatabase(databaseUrl, "paperdeck_test");

const paperCount = 250;
const topicId = randomUUID();
const runPrefix = `arxiv-benchmark-${randomUUID()}`;
const sql = postgres(databaseUrl, { max: 4, prepare: false });

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function bundle(scenario: string, index: number) {
  const arxivId = `${runPrefix}-${scenario}-${index}`;
  return {
    abstract: `Atomic ingestion benchmark abstract ${index}.`,
    arxiv_id: arxivId,
    authors: ["Benchmark Author", `Coauthor ${index}`],
    doi: null,
    pdf_url: `https://arxiv.org/pdf/${arxivId}`,
    published_at: "2026-08-01T00:00:00.000Z",
    title: `Atomic ingestion benchmark paper ${index}`,
    topic_ids: [topicId],
    updated_at: "2026-08-01T00:00:00.000Z",
    url: `https://arxiv.org/abs/${arxivId}`,
    venue: "cs.AI",
    versioned_arxiv_id: `${arxivId}v1`,
    year: 2026,
  };
}

async function callBundle(payload: ReturnType<typeof bundle>) {
  await sql`
    select public.upsert_arxiv_paper_bundle(
      ${sql.json(payload as postgres.JSONValue)}::jsonb
    )
  `;
}

async function measure(scenario: string, concurrency: number) {
  const payloads = Array.from({ length: paperCount }, (_, index) =>
    bundle(scenario, index),
  );
  const latencies: number[] = [];
  let active = 0;
  let maximumActive = 0;
  const startedAt = performance.now();
  await mapWithConcurrency(payloads, concurrency, async (payload) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    const operationStartedAt = performance.now();
    try {
      await callBundle(payload);
    } finally {
      latencies.push(performance.now() - operationStartedAt);
      active -= 1;
    }
  });
  return {
    applicationRoundTrips: paperCount,
    concurrency,
    durationMs: Number((performance.now() - startedAt).toFixed(1)),
    maximumActive,
    p50OperationMs: Number(percentile(latencies, 0.5).toFixed(2)),
    p95OperationMs: Number(percentile(latencies, 0.95).toFixed(2)),
    papers: paperCount,
  };
}

async function cleanup() {
  await sql`delete from papers where arxiv_id like ${`${runPrefix}%`}`;
  await sql`delete from taxonomy_topics where id = ${topicId}::uuid`;
}

async function main() {
  try {
    await cleanup();
    await sql`
      insert into taxonomy_topics (id, slug, label, source, arxiv_category)
      values (${topicId}::uuid, ${runPrefix}, 'arXiv benchmark topic', 'arxiv', 'cs.AI')
    `;
    const sequential = await measure("sequential", 1);
    const boundedConcurrent = await measure("concurrent", 4);
    console.log(
      JSON.stringify({
        boundedConcurrent,
        legacyApplicationRoundTripsEstimate: paperCount * 7,
        note: "The legacy estimate counts its paper, external-ID, author, and topic request chain; the atomic path makes one RPC per paper.",
        sequential,
        speedup: Number(
          (sequential.durationMs / boundedConcurrent.durationMs).toFixed(2),
        ),
      }),
    );
  } finally {
    try {
      await cleanup();
    } finally {
      await sql.end();
    }
  }
}

void main();
