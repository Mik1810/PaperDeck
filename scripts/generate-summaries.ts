import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function extractJson(text: string) {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const content = fenceMatch ? fenceMatch[1].trim() : trimmed;
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in response");
  }

  return content.slice(start, end + 1);
}

type SummaryConfig = {
  model: string;
  baseUrl: string;
  apiKey: string;
  jinaApiKey: string | null;
  batchSize: number;
  limit: number;
  dryRun: boolean;
  requestDelayMs: number;
};

type PaperRow = {
  id: string;
  arxiv_id: string | null;
  title: string;
  abstract: string;
  triage_summary: unknown;
  ingested_at: string;
};

type TriageSummary = {
  why_it_matters: string;
  main_contribution: string;
  prerequisites: string;
  read_if_you_care_about: string;
};

const CURSOR_KEY = "triage_summary_enrich";
const SYSTEM_PROMPT = `You are a research paper summarizer for CS researchers. Given the full text of a paper, produce a structured JSON summary with exactly these four fields. Each field must be around 100 words. Do NOT repeat or paraphrase the abstract — synthesise new, original insights from the full paper text.

- "why_it_matters": What specific problem or gap does this paper address? Explain the real-world stakes, the limitation of prior work, or the concrete scenario that motivated this research.
- "main_contribution": What exactly did the authors build, prove, or discover? Describe the method, algorithm, framework, dataset, or theorem. Include specific names, metrics, baselines, and key numbers from experiments.
- "prerequisites": What specific background should a reader have? Name concrete concepts, prior architectures, formal tools, or mathematical frameworks (e.g., "LTL model checking", "Graph Neural Networks", "attention mechanisms in Transformers").
- "read_if_you_care_about": Who specifically would find this paper most relevant? Name exact research communities, subfields, systems, or application domains. Be narrow — avoid "anyone in AI".

Write in English. Output ONLY the JSON object, no other text.`;

const MAX_CHARS = 15000;
const JINA_BASE = "https://r.jina.ai";

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

function parseArgs(): SummaryConfig {
  const args = process.argv.slice(2);
  const argValue = (name: string) => {
    const prefix = `--${name}=`;
    return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  };

  return {
    model: process.env.LLM_MODEL ?? "nvidia/nemotron-3-nano-30b-a3b:free",
    baseUrl: process.env.LLM_BASE_URL ?? "https://openrouter.ai/api/v1",
    apiKey: process.env.LLM_API_KEY ?? "",
    jinaApiKey: process.env.JINA_API_KEY ?? null,
    batchSize: Number(
      argValue("batch-size") ?? process.env.LLM_BATCH_SIZE ?? 5,
    ),
    limit: Number(argValue("limit") ?? process.env.LLM_LIMIT ?? 50),
    dryRun:
      args.includes("--dry-run") || process.env.LLM_DRY_RUN === "true",
    requestDelayMs: Number(
      process.env.LLM_REQUEST_DELAY_MS ?? 15000,
    ),
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

async function getPapersToSummarize(
  supabase: ReturnType<typeof createSupabaseClient>,
  limit: number,
) {
  const { data, error } = await supabase
    .from("papers")
    .select("id, arxiv_id, title, abstract, triage_summary, ingested_at")
    .eq("source", "arxiv")
    .is("triage_summary", null)
    .not("abstract", "is", null)
    .order("ingested_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data ?? []) as PaperRow[];
}

async function fetchPaperContent(arxivId: string, jinaApiKey: string | null) {
  const pdfUrl = `https://arxiv.org/pdf/${arxivId}`;
  const jinaUrl = `${JINA_BASE}/${pdfUrl}`;

  const headers: Record<string, string> = {
    Accept: "text/markdown",
  };

  if (jinaApiKey) {
    headers["Authorization"] = `Bearer ${jinaApiKey}`;
  }

  const response = await fetch(jinaUrl, { headers });

  if (!response.ok) {
    throw new Error(
      `Jina API error: ${response.status} ${response.statusText}`,
    );
  }

  return response.text();
}

function chunkText(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return [text];
  }

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);

  if (paragraphs.length === 1) {
    for (let i = 0; i < text.length; i += maxChars) {
      chunks.push(text.slice(i, i + maxChars));
    }
    return chunks;
  }

  let current = "";

  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length + 2 > maxChars) {
      chunks.push(current.trim());
      current = paragraph;
    } else {
      current += (current ? "\n\n" : "") + paragraph;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

async function callLLM(
  config: SummaryConfig,
  body: Record<string, unknown>,
  retries = 3,
): Promise<{ choices: Array<{ message: { content: string | null; reasoning?: string } }> }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        "HTTP-Referer": "https://paperdeck.michaelpiccirilli.it",
        "X-Title": "PaperDeck",
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      return response.json();
    }

    if (response.status === 429 && attempt < retries) {
      const retryAfter = response.headers.get("Retry-After");
      const delay = retryAfter
        ? Number(retryAfter) * 1000
        : (attempt + 1) * 15000;
      console.error(
        `  Rate limited, retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${retries})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    throw new Error(
      `LLM API error: ${response.status} ${response.statusText}`,
    );
  }

  throw new Error("LLM API error: max retries exceeded");
}

async function summarizeChunk(
  config: SummaryConfig,
  title: string,
  chunk: string,
  chunkIndex: number,
  totalChunks: number,
) {
  const prefix =
    totalChunks > 1
      ? `[Part ${chunkIndex + 1}/${totalChunks}]\n\n`
      : "";

  const userContent = `Paper title: ${title}\n\n${prefix}${chunk}`;

  const data = await callLLM(config, {
    model: config.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    temperature: 0.3,
    max_tokens: 1600,
  });

  const message = data.choices?.[0]?.message;
  const raw = (message?.content ?? "") || (message?.reasoning ?? "");

  if (!raw) {
    throw new Error("Empty LLM response");
  }

  try {
    return JSON.parse(extractJson(raw)) as TriageSummary;
  } catch {
    if (message?.reasoning && message.reasoning !== raw) {
      try {
        return JSON.parse(extractJson(message.reasoning)) as TriageSummary;
      } catch {
        // fall through to error
      }
    }
    console.error(`  JSON parse failed, raw: ${raw.slice(0, 200)}`);
    throw new Error("LLM did not return valid JSON");
  }
}

async function generateSummary(
  config: SummaryConfig,
  paper: PaperRow,
) {
  let content = paper.abstract;

  if (paper.arxiv_id) {
    try {
      const fullText = await fetchPaperContent(paper.arxiv_id, config.jinaApiKey);
      if (fullText && fullText.length > 200) {
        content = fullText;
        console.error(`  Jina: fetched ${fullText.length} chars for ${paper.arxiv_id}`);
      }
    } catch (error) {
      console.error(
        `  Jina failed for ${paper.arxiv_id}, falling back to abstract: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const chunks = chunkText(content, MAX_CHARS);

  if (chunks.length === 1) {
    return summarizeChunk(config, paper.title, chunks[0], 0, 1);
  }

  const chunkSummaries: TriageSummary[] = [];

  for (let i = 0; i < chunks.length; i++) {
    console.error(`  Chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)`);

    const summary = await summarizeChunk(
      config,
      paper.title,
      chunks[i],
      i,
      chunks.length,
    );

    chunkSummaries.push(summary);
  }

  return mergeChunkSummaries(config, paper.title, chunkSummaries);
}

async function mergeChunkSummaries(
  config: SummaryConfig,
  title: string,
  summaries: TriageSummary[],
) {
  const parts = summaries
    .map(
      (s, i) =>
        `Part ${i + 1}:\n${JSON.stringify(s)}`,
    )
    .join("\n\n");

  const userContent =
    `Paper title: ${title}\n\nCombine these partial summaries into a single final summary:\n\n${parts}`;

  const data = await callLLM(config, {
    model: config.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    temperature: 0.3,
    max_tokens: 1600,
  });

  const message = data.choices?.[0]?.message;
  const raw = (message?.content ?? "") || (message?.reasoning ?? "");

  try {
    return JSON.parse(extractJson(raw)) as TriageSummary;
  } catch {
    return summaries[0];
  }
}

function validateSummary(
  summary: Record<string, unknown>,
): summary is TriageSummary {
  const fields = [
    "why_it_matters",
    "main_contribution",
    "prerequisites",
    "read_if_you_care_about",
  ];

  return fields.every(
    (field) =>
      typeof summary[field] === "string" &&
      (summary[field] as string).length > 0,
  );
}

async function updatePaper(
  supabase: ReturnType<typeof createSupabaseClient>,
  paper: PaperRow,
  summary: TriageSummary,
  config: SummaryConfig,
) {
  const { error } = await supabase
    .from("papers")
    .update({
      triage_summary: summary,
      triage_summary_model: config.model,
      triage_summary_generated_at: new Date().toISOString(),
    })
    .eq("id", paper.id);

  if (error) {
    throw error;
  }
}

async function getCursor(
  supabase: ReturnType<typeof createSupabaseClient>,
) {
  const { data, error } = await supabase
    .from("ingestion_cursors")
    .select("cursor_value, imported_count")
    .eq("source", "arxiv")
    .eq("cursor_key", CURSOR_KEY)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as { cursor_value: string | null; imported_count: number } | null;
}

async function updateCursor(
  supabase: ReturnType<typeof createSupabaseClient>,
  totalEnriched: number,
  lastPaperId: string,
) {
  const { error } = await supabase.from("ingestion_cursors").upsert(
    {
      source: "arxiv",
      cursor_key: CURSOR_KEY,
      cursor_value: lastPaperId,
      imported_count: totalEnriched,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "source,cursor_key" },
  );

  if (error) {
    throw error;
  }
}

async function main() {
  loadLocalEnv();
  const config = parseArgs();

  if (!config.dryRun && !config.apiKey) {
    throw new Error("Missing LLM_API_KEY (required for write mode)");
  }

  console.error(
    `Generating summaries with ${config.model} (limit ${config.limit}, dry-run: ${config.dryRun})`,
  );

  const supabase = createSupabaseClient();
  const papers = await getPapersToSummarize(supabase, config.limit);

  if (!papers.length) {
    console.error("No papers found needing summaries");
    return;
  }

  console.error(`Found ${papers.length} papers to summarize`);

  if (config.dryRun) {
    console.log(
      JSON.stringify({
        mode: "dry-run",
        papersToProcess: papers.length,
        sampleTitle: papers[0]?.title.slice(0, 80) ?? null,
        sampleAbstract: papers[0]?.abstract.slice(0, 120) ?? null,
      }),
    );
    return;
  }

  const cursor = await getCursor(supabase);
  let totalGenerated = 0;
  let totalFailed = 0;

  for (let i = 0; i < papers.length; i += config.batchSize) {
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.requestDelayMs));
    }

    const batch = papers.slice(i, i + config.batchSize);

    console.error(
      `Batch ${Math.floor(i / config.batchSize) + 1}: ${batch.length} papers`,
    );

    for (const paper of batch) {
      try {
        const summary = await generateSummary(config, paper);

        if (!validateSummary(summary)) {
          console.error(
            `  SKIP ${paper.arxiv_id ?? paper.id.slice(0, 8)}: invalid format`,
          );
          totalFailed++;
          continue;
        }

        totalGenerated++;
        await updatePaper(supabase, paper, summary, config);

        console.error(
          `  OK ${paper.arxiv_id}: ${summary.main_contribution.slice(0, 60)}...`,
        );
      } catch (error) {
        totalFailed++;
        console.error(
          `  FAIL ${paper.arxiv_id ?? paper.id.slice(0, 8)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const lastPaper = batch[batch.length - 1];
    await updateCursor(supabase, totalGenerated, lastPaper.id);
  }

  const summary = {
    mode: "write",
    papersChecked: papers.length,
    generated: totalGenerated,
    failed: totalFailed,
  };

  console.log(JSON.stringify(summary));
}

void main();
