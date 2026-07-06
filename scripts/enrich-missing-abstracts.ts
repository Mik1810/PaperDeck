import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { XMLParser } from "fast-xml-parser";

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf("=");
    if (sep === -1) continue;
    const key = line.slice(0, sep);
    const value = line.slice(sep + 1).replace(/^['"]|['"]$/g, "");
    process.env[key] ??= value;
  }
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function createSupabaseClient() {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    limit: Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 50),
    dryRun: args.includes("--dry-run"),
    requestDelayMs: 1500,
  };
}

async function fetchArxivAbstract(arxivId: string): Promise<string | null> {
  const params = new URLSearchParams({
    id_list: arxivId,
    max_results: "1",
  });
  const url = `https://export.arxiv.org/api/query?${params}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "PaperDeck/0.1.0 (https://paperdeck.michaelpiccirilli.it)" },
  });
  if (!response.ok) {
    console.error(`  arXiv fetch failed for ${arxivId}: ${response.status}`);
    return null;
  }
  const text = await response.text();
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const parsed = parser.parse(text) as { feed?: { entry?: Record<string, unknown> } };
  const entry = parsed.feed?.entry;
  if (!entry) return null;
  const summary = typeof entry.summary === "string" ? entry.summary : "";
  return summary.replace(/\s+/g, " ").trim() || null;
}

async function fetchS2Abstract(semanticScholarId: string, apiKey?: string): Promise<string | null> {
  const url = `https://api.semanticscholar.org/graph/v1/paper/${semanticScholarId}?fields=title,abstract`;
  const headers: Record<string, string> = {};
  if (apiKey) headers["x-api-key"] = apiKey;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) return null;
    const data = await res.json() as { abstract?: string };
    return data.abstract?.trim() || null;
  }
  return null;
}

async function fetchOpenAlexAbstract(doi: string): Promise<string | null> {
  const url = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?select=abstract_inverted_index`;
  const res = await fetch(url, { headers: { "User-Agent": "mailto:paperdeck@michaelpiccirilli.it" } });
  if (!res.ok) return null;
  const data = await res.json() as { abstract_inverted_index?: Record<string, number[]> };
  const index = data.abstract_inverted_index;
  if (!index) return null;
  const words: Array<{ position: number; word: string }> = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) {
      words.push({ position: pos, word });
    }
  }
  words.sort((a, b) => a.position - b.position);
  return words.map((w) => w.word).join(" ").trim() || null;
}

async function searchArxivByTitle(title: string): Promise<{ arxivId: string; abstract: string } | null> {
  const clean = title.replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const keywords = clean.split(" ").filter((w) => w.length > 3).slice(0, 8).join("+AND+");
  if (!keywords) return null;

  const params = new URLSearchParams({
    search_query: `ti:${keywords}`,
    max_results: "3",
    sortBy: "relevance",
  });
  const url = `https://export.arxiv.org/api/query?${params}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "PaperDeck/0.1.0 (https://paperdeck.michaelpiccirilli.it)" },
  });
  if (!res.ok) return null;

  const text = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const parsed = parser.parse(text) as { feed?: { entry?: Record<string, unknown> | Record<string, unknown>[] } };
  const entries = [parsed.feed?.entry].flat().filter(Boolean) as Record<string, unknown>[];

  if (!entries.length) return null;

  const entry = entries[0];
  const idUrl = String(entry.id ?? "");
  const arxivId = idUrl.split("/abs/").at(-1)?.replace(/v\d+$/i, "").trim();
  const summary = String(entry.summary ?? "").replace(/\s+/g, " ").trim();

  if (!arxivId || !summary) return null;
  return { arxivId, abstract: summary };
}

async function main() {
  loadLocalEnv();
  const { limit, dryRun, requestDelayMs } = parseArgs();
  const supabase = createSupabaseClient();

  const { data: papers, error } = await supabase
    .from("papers")
    .select("id, arxiv_id, doi, semantic_scholar_id, title, abstract")
    .or("abstract.is.null,abstract.eq.")
    .order("ingested_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  if (!papers?.length) {
    console.log("No papers with missing abstracts found.");
    return;
  }

  console.log(`Found ${papers.length} papers with missing abstracts.`);
  if (dryRun) console.log("DRY RUN — no writes.");

  let enriched = 0;
  let skipped = 0;

  for (const paper of papers) {
    let newAbstract: string | null = null;
    let source = "";
    const s2Key = process.env.SEMANTIC_SCHOLAR_API_KEY;

    if (paper.arxiv_id) {
      newAbstract = await fetchArxivAbstract(paper.arxiv_id);
      source = "arxiv";
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!newAbstract && paper.semantic_scholar_id) {
      newAbstract = await fetchS2Abstract(paper.semantic_scholar_id, s2Key);
      if (newAbstract) source = "semantic_scholar";
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!newAbstract && paper.doi) {
      newAbstract = await fetchOpenAlexAbstract(paper.doi);
      if (newAbstract) source = "openalex";
    }

    if (!newAbstract) {
      const arxivResult = await searchArxivByTitle(paper.title!);
      if (arxivResult) {
        newAbstract = arxivResult.abstract;
        source = "arxiv_title_search";

        if (!dryRun && !paper.arxiv_id) {
          await supabase
            .from("papers")
            .update({ arxiv_id: arxivResult.arxivId })
            .eq("id", paper.id);
        }
      }
    }

    if (!newAbstract) {
      skipped++;
      console.log(`  SKIP: ${paper.title?.slice(0, 60)}... (no source had abstract)`);
      continue;
    }

    if (dryRun) {
      console.log(`  [DRY RUN] Would update ${paper.id.slice(0, 8)}... via ${source}`);
      enriched++;
    } else {
      const { error: updateError } = await supabase
        .from("papers")
        .update({ abstract: newAbstract })
        .eq("id", paper.id);

      if (updateError) {
        console.error(`  FAILED: ${paper.id} — ${updateError.message}`);
        skipped++;
      } else {
        console.log(`  ENRICHED: ${paper.title?.slice(0, 60)}... via ${source} (${newAbstract.length} chars)`);
        enriched++;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, requestDelayMs));
  }

  console.log();
  console.log(`Done: ${enriched} enriched, ${skipped} skipped.`);
  if (dryRun) console.log("Note: this was a dry run.");
}

void main();
