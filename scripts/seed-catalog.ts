import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { mockPapers, topicTree } from "../src/lib/mock-data";
import { paperSourceToDatabase } from "../src/lib/paper-sources";

type TopicSeed = (typeof topicTree)[number];

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

async function seedTopic(
  supabase: ReturnType<typeof createSupabaseClient>,
  topic: TopicSeed,
  parentId: string | null,
  sortOrder: number,
) {
  const { data, error } = await supabase
    .from("taxonomy_topics")
    .upsert(
      {
        slug: topic.id,
        label: topic.label,
        parent_id: parentId,
        source: "paperdeck_seed",
        arxiv_category: topic.arxivCategory ?? null,
        depth: topicDepth(topic.id),
        sort_order: sortOrder,
      },
      { onConflict: "slug" },
    )
    .select("id, slug")
    .single();

  assertNoError(error, `Seed topic ${topic.id}`);
  if (!data) {
    throw new Error(`Seed topic ${topic.id}: missing saved row`);
  }

  return {
    id: data.id as string,
    slug: data.slug as string,
  };
}

async function main() {
  loadLocalEnv();

  if (process.argv.includes("--dry-run")) {
    console.log(
      JSON.stringify({
        mode: "dry-run",
        topics: topicTree.length,
        papers: mockPapers.length,
      }),
    );
    return;
  }

  const supabase = createSupabaseClient();
  const sortedTopics = [...topicTree].sort(
    (a, b) => topicDepth(a.id) - topicDepth(b.id),
  );
  const topicIdsBySlug = new Map<string, string>();

  for (const [index, topic] of sortedTopics.entries()) {
    const parentId = topic.parentId ? topicIdsBySlug.get(topic.parentId) : null;
    const savedTopic = await seedTopic(supabase, topic, parentId ?? null, index);
    topicIdsBySlug.set(savedTopic.slug, savedTopic.id);
  }

  for (const paper of mockPapers) {
    const identity = paperIdentities[paper.id];

    if (!identity) {
      throw new Error(`Missing seed identity for ${paper.id}`);
    }

    const paperPayload = {
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

  console.log(
    JSON.stringify({
      mode: "write",
      topics: topicTree.length,
      papers: mockPapers.length,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
