import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

type ParaphrasedEntry = {
  id: string;
  title: string;
  abstract: string | null;
  abstract_status: "found" | "not_found";
  abstract_kind: "non_verbatim_paraphrase" | null;
  source_url: string | null;
  note: string;
};

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

async function main() {
  loadLocalEnv();
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filePath = args.find((a) => a.endsWith(".json")) ?? "paperdeck_abstracts_simple.json";

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const entries: ParaphrasedEntry[] = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const toImport = entries.filter((e) => e.abstract_status === "found" && e.abstract);

  console.log(`Found ${toImport.length} entries with paraphrased descriptions.`);
  if (dryRun) console.log("DRY RUN — no writes.");

  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  let imported = 0;
  let skipped = 0;

  for (const entry of toImport) {
    // Check if paper already has an abstract
    const { data: existing } = await supabase
      .from("papers")
      .select("id, abstract")
      .eq("id", entry.id)
      .single();

    if (!existing) {
      console.log(`  SKIP: ${entry.title.slice(0, 60)}... (paper not found)`);
      skipped++;
      continue;
    }

    if (existing.abstract) {
      console.log(`  SKIP: ${entry.title.slice(0, 60)}... (already has abstract)`);
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`  [DRY RUN] Would import: ${entry.title.slice(0, 60)}...`);
      imported++;
      continue;
    }

    const { error } = await supabase
      .from("papers")
      .update({ abstract: entry.abstract })
      .eq("id", entry.id);

    if (error) {
      console.error(`  FAILED: ${entry.id} — ${error.message}`);
      skipped++;
    } else {
      console.log(`  IMPORTED: ${entry.title.slice(0, 60)}...`);
      imported++;
    }
  }

  console.log();
  console.log(`Done: ${imported} imported, ${skipped} skipped.`);
  if (dryRun) console.log("Note: this was a dry run.");
}

void main();
