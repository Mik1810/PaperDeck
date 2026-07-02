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

type LlmProvider = "cloudflare" | "gemini" | "github";
type LlmMessage = { role: "system" | "user"; content: string };

type SummaryConfig = {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  cloudflareAccountId: string;
  cloudflareApiToken: string;
  githubToken: string;
  jinaApiKey: string | null;
  batchSize: number;
  limit: number;
  dryRun: boolean;
  requestDelayMs: number;
  sourceTextChars: number;
  maxInputChars: number;
  maxOutputTokens: number;
  retries: number;
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
const DEFAULT_CLOUDFLARE_MODEL = "@cf/zai-org/glm-4.7-flash";
const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
const DEFAULT_GITHUB_MODEL = "openai/gpt-4o-mini";
const SYSTEM_PROMPT = `You are a research paper summarizer for CS researchers. Given the text of a paper (which may contain PDF artifacts, garbled symbols, or LaTeX fragments), ignore formatting noise and extract the semantic meaning. Produce a structured JSON summary with exactly these four fields. Each field must be around 100 words. Do NOT repeat or paraphrase the abstract — synthesize new, original insights.

- "why_it_matters": What specific problem or gap does this paper address? Explain the real-world stakes, the limitation of prior work, or the concrete scenario that motivated this research.
- "main_contribution": What exactly did the authors build, prove, or discover? Describe the method, algorithm, framework, dataset, or theorem. Include specific names, metrics, baselines, and key numbers from experiments.
- "prerequisites": What specific background should a reader have? Name concrete concepts, prior architectures, formal tools, or mathematical frameworks.
- "read_if_you_care_about": Who specifically would find this paper most relevant? Name exact research communities, subfields, systems, or application domains.

Write in English. Output ONLY the JSON object, no other text.`;

const JINA_BASE = "https://r.jina.ai";
const TRIAGE_SUMMARY_JSON_SCHEMA = {
  type: "object",
  properties: {
    why_it_matters: {
      type: "string",
      description: "Why this paper matters and what gap it addresses.",
    },
    main_contribution: {
      type: "string",
      description: "The paper's concrete method, finding, artifact, or result.",
    },
    prerequisites: {
      type: "string",
      description: "Background concepts a reader should know first.",
    },
    read_if_you_care_about: {
      type: "string",
      description: "The specific reader profile, subfield, or application area.",
    },
  },
  required: [
    "why_it_matters",
    "main_contribution",
    "prerequisites",
    "read_if_you_care_about",
  ],
  additionalProperties: false,
} as const;

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
  const providerArg = argValue("provider");
  const modelArg = argValue("model");
  const envProvider = process.env.LLM_PROVIDER;
  const envModel = process.env.LLM_MODEL;
  const provider = parseProvider(providerArg ?? envProvider, modelArg ?? envModel);
  const hasExplicitProvider = Boolean(providerArg ?? envProvider);

  return {
    provider,
    model:
      modelArg ??
      resolveEnvModel(provider, envModel, hasExplicitProvider),
    apiKey: process.env.LLM_API_KEY ?? "",
    cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    cloudflareApiToken:
      process.env.CLOUDFLARE_API_TOKEN ??
      process.env.CLOUDFLARE_AUTH_TOKEN ??
      "",
    githubToken: process.env.GITHUB_MODELS_TOKEN ?? process.env.GITHUB_TOKEN ?? "",
    jinaApiKey: process.env.JINA_API_KEY ?? null,
    batchSize: Number(
      argValue("batch-size") ?? process.env.LLM_BATCH_SIZE ?? 5,
    ),
    limit: Number(argValue("limit") ?? process.env.LLM_LIMIT ?? 50),
    dryRun:
      args.includes("--dry-run") || process.env.LLM_DRY_RUN === "true",
    requestDelayMs: Number(
      process.env.LLM_REQUEST_DELAY_MS ?? 5000,
    ),
    sourceTextChars: Number(
      argValue("source-text-chars") ??
        process.env.LLM_SOURCE_TEXT_CHARS ??
        30000,
    ),
    maxInputChars: Number(
      argValue("max-input-chars") ??
        process.env.LLM_MAX_INPUT_CHARS ??
        500000,
    ),
    maxOutputTokens: Number(
      argValue("max-output-tokens") ??
        process.env.LLM_MAX_OUTPUT_TOKENS ??
        3200,
    ),
    retries: Number(process.env.LLM_RETRIES ?? 5),
  };
}

function parseProvider(value: string | undefined, model: string | undefined): LlmProvider {
  if (!value || value === "cloudflare") {
    if (!value && model?.startsWith("gemini")) {
      return "gemini";
    }

    if (!value && model?.includes("/") && !model.startsWith("@cf/")) {
      return "github";
    }

    return "cloudflare";
  }

  if (value === "gemini") {
    return value;
  }

  if (value === "github") {
    return value;
  }

  throw new Error(
    `Unsupported LLM_PROVIDER "${value}". Expected "cloudflare", "gemini", or "github".`,
  );
}

function defaultModelFor(provider: LlmProvider) {
  if (provider === "cloudflare") {
    return DEFAULT_CLOUDFLARE_MODEL;
  }

  if (provider === "github") {
    return DEFAULT_GITHUB_MODEL;
  }

  return DEFAULT_GEMINI_MODEL;
}

function isLikelyProviderModel(provider: LlmProvider, model: string) {
  if (provider === "cloudflare") {
    return model.startsWith("@cf/");
  }

  if (provider === "github") {
    return model.includes("/") && !model.startsWith("@cf/");
  }

  return model.startsWith("gemini");
}

function resolveEnvModel(
  provider: LlmProvider,
  envModel: string | undefined,
  hasExplicitProvider: boolean,
) {
  if (!envModel) {
    return defaultModelFor(provider);
  }

  if (hasExplicitProvider && !isLikelyProviderModel(provider, envModel)) {
    return defaultModelFor(provider);
  }

  return envModel;
}

function requireLlmConfig(config: SummaryConfig) {
  if (config.dryRun) {
    return;
  }

  if (config.provider === "cloudflare") {
    if (!config.cloudflareAccountId) {
      throw new Error("Missing CLOUDFLARE_ACCOUNT_ID (required for Cloudflare Workers AI)");
    }

    if (!config.cloudflareApiToken) {
      throw new Error("Missing CLOUDFLARE_API_TOKEN (required for Cloudflare Workers AI)");
    }

    return;
  }

  if (config.provider === "github") {
    if (!config.githubToken) {
      throw new Error("Missing GITHUB_TOKEN or GITHUB_MODELS_TOKEN (required for GitHub Models)");
    }

    return;
  }

  if (!config.apiKey) {
    throw new Error("Missing LLM_API_KEY (required for Gemini write mode)");
  }
}

function modelLabel(config: SummaryConfig) {
  return `${config.provider}:${config.model}`;
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

function cleanText(text: string) {
  return text
    .replace(/[^\x20-\x7E\u00A0-\u00FF\u0100-\u017F\u2010-\u2060\u2190-\u21FF\u2200-\u22FF\u2300-\u23FF\u03B1-\u03C9\u2207]/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

async function callGemini(
  config: SummaryConfig,
  messages: LlmMessage[],
  maxTokens: number,
  retries = config.retries,
): Promise<string> {
  const systemMsg = messages.find((m) => m.role === "system");
  const userMsg = messages.find((m) => m.role === "user");
  const systemInstruction = systemMsg
    ? { system_instruction: { parts: [{ text: systemMsg.content }] } }
    : {};

  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...systemInstruction,
          contents: [{ parts: [{ text: userMsg?.content ?? "" }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: maxTokens,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (response.ok) {
      const data = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    }

    if ((response.status === 429 || response.status === 503) && attempt < retries) {
      const retryAfter = response.headers.get("Retry-After");
      const delay = retryAfter
        ? Number(retryAfter) * 1000
        : (attempt + 1) * 15000;
      console.error(
        `  ${response.status} error, retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${retries})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    const errorText = await response.text();
    throw new Error(
      `Gemini API error (${response.status}): ${errorText.slice(0, 200)}`,
    );
  }

  throw new Error("Gemini API error: max retries exceeded");
}

type CloudflareAiEnvelope = {
  success?: boolean;
  result?: unknown;
  errors?: Array<{ code?: number | string; message?: string }>;
  messages?: unknown[];
};

function getRetryDelayMs(response: Response, attempt: number) {
  const retryAfter = response.headers.get("Retry-After");
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }

  return (attempt + 1) * 15000;
}

function shouldRetryLlmStatus(status: number) {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function cloudflareErrorMessage(data: CloudflareAiEnvelope | null, fallback: string) {
  const message = data?.errors
    ?.map((error) =>
      [error.code, error.message].filter(Boolean).join(": "),
    )
    .filter(Boolean)
    .join("; ");

  return message || fallback.slice(0, 300);
}

function cloudflareResultToText(result: unknown): string | null {
  if (typeof result === "string") {
    return result;
  }

  if (!result || typeof result !== "object") {
    return null;
  }

  const record = result as Record<string, unknown>;
  const response = record.response;

  if (typeof response === "string") {
    return response;
  }

  if (response && typeof response === "object") {
    return JSON.stringify(response);
  }

  const choices = record.choices;

  if (Array.isArray(choices)) {
    const firstChoice = choices[0] as Record<string, unknown> | undefined;
    const message = firstChoice?.message as Record<string, unknown> | undefined;
    const content = message?.content ?? firstChoice?.text;

    if (typeof content === "string") {
      return content;
    }

    if (content && typeof content === "object") {
      return JSON.stringify(content);
    }
  }

  return null;
}

async function callCloudflareWorkersAi(
  config: SummaryConfig,
  messages: LlmMessage[],
  maxTokens: number,
  retries = config.retries,
): Promise<string> {
  const url =
    `https://api.cloudflare.com/client/v4/accounts/${config.cloudflareAccountId}/ai/run/${config.model}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.cloudflareApiToken}`,
      },
      body: JSON.stringify({
        messages,
        temperature: 0.2,
        max_tokens: maxTokens,
        max_completion_tokens: maxTokens,
        response_format: {
          type: "json_schema",
          json_schema: TRIAGE_SUMMARY_JSON_SCHEMA,
        },
      }),
    });

    const responseText = await response.text();
    let data: CloudflareAiEnvelope | null = null;

    try {
      data = JSON.parse(responseText) as CloudflareAiEnvelope;
    } catch {
      data = null;
    }

    if (response.ok && data?.success !== false) {
      const content = cloudflareResultToText(data?.result);

      if (content) {
        return content;
      }

      throw new Error(
        `Cloudflare Workers AI returned no text content: ${responseText.slice(0, 300)}`,
      );
    }

    if (shouldRetryLlmStatus(response.status) && attempt < retries) {
      const delay = getRetryDelayMs(response, attempt);
      console.error(
        `  ${response.status} error, retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${retries})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    throw new Error(
      `Cloudflare Workers AI error (${response.status}): ${cloudflareErrorMessage(data, responseText)}`,
    );
  }

  throw new Error("Cloudflare Workers AI error: max retries exceeded");
}

type GitHubModelsResponse = {
  choices?: Array<{
    message?: {
      content?: string | Record<string, unknown>;
    };
    text?: string;
  }>;
  error?: {
    message?: string;
    code?: string | number;
  };
  message?: string;
};

function githubModelsResponseToText(data: GitHubModelsResponse): string | null {
  const firstChoice = data.choices?.[0];
  const content = firstChoice?.message?.content ?? firstChoice?.text;

  if (typeof content === "string") {
    return content;
  }

  if (content && typeof content === "object") {
    return JSON.stringify(content);
  }

  return null;
}

function githubModelsErrorMessage(data: GitHubModelsResponse | null, fallback: string) {
  if (data?.error?.message) {
    return [data.error.code, data.error.message].filter(Boolean).join(": ");
  }

  return data?.message ?? fallback.slice(0, 300);
}

async function callGitHubModels(
  config: SummaryConfig,
  messages: LlmMessage[],
  maxTokens: number,
  retries = config.retries,
): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(
      "https://models.github.ai/inference/chat/completions",
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2026-03-10",
          Authorization: `Bearer ${config.githubToken}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: 0.2,
          max_tokens: maxTokens,
          response_format: {
            type: "json_schema",
            json_schema: TRIAGE_SUMMARY_JSON_SCHEMA,
          },
        }),
      },
    );

    const responseText = await response.text();
    let data: GitHubModelsResponse | null = null;

    try {
      data = JSON.parse(responseText) as GitHubModelsResponse;
    } catch {
      data = null;
    }

    if (response.ok && data) {
      const content = githubModelsResponseToText(data);

      if (content) {
        return content;
      }

      throw new Error(
        `GitHub Models returned no text content: ${responseText.slice(0, 300)}`,
      );
    }

    if (shouldRetryLlmStatus(response.status) && attempt < retries) {
      const delay = getRetryDelayMs(response, attempt);
      console.error(
        `  ${response.status} error, retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${retries})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    throw new Error(
      `GitHub Models error (${response.status}): ${githubModelsErrorMessage(data, responseText)}`,
    );
  }

  throw new Error("GitHub Models error: max retries exceeded");
}

async function callLlm(
  config: SummaryConfig,
  messages: LlmMessage[],
  maxTokens: number,
) {
  if (config.provider === "cloudflare") {
    return callCloudflareWorkersAi(config, messages, maxTokens);
  }

  if (config.provider === "github") {
    return callGitHubModels(config, messages, maxTokens);
  }

  return callGemini(config, messages, maxTokens);
}

function parseTriageSummary(raw: string, provider: LlmProvider) {
  try {
    return JSON.parse(raw) as TriageSummary;
  } catch {
    try {
      return JSON.parse(extractJson(raw)) as TriageSummary;
    } catch {
      console.error(`  JSON parse failed, raw: ${raw.slice(0, 200)}`);
      throw new Error(`${provider} did not return valid JSON`);
    }
  }
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

  const raw = await callLlm(
    config,
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    config.maxOutputTokens,
  );

  return parseTriageSummary(raw, config.provider);
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
        const cleaned = cleanText(fullText);
        content =
          config.sourceTextChars > 0
            ? cleaned.slice(0, config.sourceTextChars)
            : cleaned;
        console.error(
          `  Jina: fetched ${fullText.length} chars for ${paper.arxiv_id}, using ${content.length}`,
        );
      }
    } catch (error) {
      console.error(
        `  Jina failed for ${paper.arxiv_id}, falling back to abstract: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const chunks = chunkText(content, config.maxInputChars);

  if (chunks.length === 1) {
    return summarizeChunk(config, paper.title, chunks[0], 0, 1);
  }

  const chunkSummaries: TriageSummary[] = [];

  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

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

  const raw = await callLlm(
    config,
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    config.maxOutputTokens,
  );

  try {
    return parseTriageSummary(raw, config.provider);
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
      triage_summary_model: modelLabel(config),
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

  requireLlmConfig(config);

  console.error(
    `Generating summaries with ${modelLabel(config)} (limit ${config.limit}, dry-run: ${config.dryRun})`,
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
  const previousImportedCount = cursor?.imported_count ?? 0;
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

    for (const [paperIndex, paper] of batch.entries()) {
      if (paperIndex > 0) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
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
    await updateCursor(
      supabase,
      previousImportedCount + totalGenerated,
      lastPaper.id,
    );
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
