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
    requestDelayMs: 3100,
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
    console.error(`arXiv fetch failed for ${arxivId}: ${response.status}`);
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

async function main() {
  loadLocalEnv();
  const { limit, dryRun, requestDelayMs } = parseArgs();
  const supabase = createSupabaseClient();

  const { data: papers, error } = await supabase
    .from("papers")
    .select("id, arxiv_id, doi, title, abstract")
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

    if (paper.arxiv_id) {
      newAbstract = await fetchArxivAbstract(paper.arxiv_id);
      source = "arxiv";
    }

    if (!newAbstract) {
      skipped++;
      console.log(`  SKIP: ${paper.title?.slice(0, 60)}... (no arxiv_id or fetch failed)`);
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
