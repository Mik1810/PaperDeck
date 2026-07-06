import fs from "node:fs";
import { execSync } from "node:child_process";

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run") || args.includes("--dry_run");
  const verbose = args.includes("--verbose") || args.includes("-v");
  const labelArgs = args.filter((a) => a.startsWith("--label="));
  const defaultLabels = labelArgs.flatMap((a) =>
    a.replace("--label=", "").split(",").map((l) => l.trim()),
  );

  const fileIndex = args.findIndex((a) => a === "--file" || a === "-f");
  let file: string | null = null;
  if (fileIndex !== -1 && fileIndex + 1 < args.length) {
    file = args[fileIndex + 1];
  } else {
    const positional = args.filter(
      (a) => !a.startsWith("-") && a !== "--file" && a !== "-f",
    );
    if (positional.length > 0) file = positional[positional.length - 1];
  }

  return { dryRun, verbose, file, defaultLabels };
}

function ghAvailable(): boolean {
  try {
    execSync("gh auth status", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function getOpenIssueTitles(): Map<string, number> {
  const map = new Map<string, number>();
  try {
    const result = execSync(
      "gh issue list --state open --limit 500 --json title,number",
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const issues: Array<{ title: string; number: number }> =
      JSON.parse(result);
    for (const issue of issues) {
      map.set(issue.title.toLowerCase().trim(), issue.number);
    }
  } catch (e) {
    console.error("Failed to list open issues:", e);
  }
  return map;
}

function getExistingLabels(): Set<string> {
  const labels = new Set<string>();
  try {
    const result = execSync("gh label list --limit 200 --json name", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const list: Array<{ name: string }> = JSON.parse(result);
    for (const lbl of list) {
      labels.add(lbl.name);
    }
  } catch {
    console.error("Failed to fetch labels. Skipping label verification.");
  }
  return labels;
}

function getDefaultLabel(labels: string[]): string | null {
  const priorityLabels = labels.filter((l) =>
    /^(priority:|p[0-3])/i.test(l),
  );
  const typeLabels = labels.filter((l) => /^(type:|kind:)/i.test(l));
  const areaLabels = labels.filter((l) => /^(area:|component:)/i.test(l));

  const all = [...priorityLabels, ...areaLabels, ...typeLabels];
  if (all.length > 0) return all[0];
  if (labels.length > 0) return labels[0];
  return null;
}

function createMissingLabels(
  labels: string[],
  existing: Set<string>,
  defaultLabel: string | null,
  dryRun: boolean,
  verbose: boolean,
): string[] {
  const created: string[] = [];
  for (const label of labels) {
    if (existing.has(label)) continue;

    const color = /priority/.test(label)
      ? "fbca04"
      : /bug/.test(label)
        ? "d73a4a"
        : /enhancement/.test(label)
          ? "a2eeef"
          : /security/.test(label)
            ? "d93f0b"
            : /refactor/.test(label)
              ? "c5def5"
              : /test/.test(label)
                ? "5319e7"
                : /frontend/.test(label)
                  ? "fbca04"
                  : /documentation/.test(label)
                    ? "0075ca"
                    : "ededed";

    const description =
      label === defaultLabel ? "Default issue label" : "";

    if (verbose) console.log(`  Creating label: ${label}`);
    if (!dryRun) {
      try {
        execSync(
          `gh label create "${label}" --color "${color}" --description "${description}"`,
          { stdio: "ignore" },
        );
        created.push(label);
        existing.add(label);
      } catch (e) {
        console.error(`  Failed to create label ${label}:`, e);
      }
    } else {
      created.push(label);
    }
  }
  return created;
}

type IssueEntry = {
  title: string;
  labels: string[];
  body: string;
  section: string;
};

const HEADING_ISSUE_RE = /^###?\s+\d+\.\d+\s+/;
const HEADING_ISSUE_SIMPLE_RE = /^###?\s+\d+\.\s+/;
const HEADING_BLOCK_RE = /^##\s+(.+)/;
const SEPARATOR_RE = /^---\s*$/;

function parseMarkdownIssues(
  content: string,
  defaultLabels: string[],
): IssueEntry[] {
  const issues: IssueEntry[] = [];
  const lines = content.split("\n");

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (HEADING_ISSUE_RE.test(line) || HEADING_ISSUE_SIMPLE_RE.test(line)) {
      const entry = parseClassicBlock(lines, i, defaultLabels);
      if (entry) {
        issues.push(entry);
        i = entry._nextIndex ?? i + 1;
      } else {
        i++;
      }
      continue;
    }

    if (HEADING_BLOCK_RE.test(line) && i >= 0) {
      const entry = parseSeparatedBlock(lines, i, defaultLabels, line);
      if (entry) {
        issues.push(entry);
        i = entry._nextIndex ?? i + 1;
      } else {
        i++;
      }
      continue;
    }

    i++;
  }

  return issues;
}

type ParsedEntry = IssueEntry & { _nextIndex?: number };

function parseClassicBlock(
  lines: string[],
  start: number,
  defaultLabels: string[],
): ParsedEntry | null {
  const title = lines[start].replace(/^###?\s+/, "").trim();
  let labels: string[] = [...defaultLabels];
  let section = "";
  const bodyLines: string[] = [];

  let i = start + 1;
  while (i < lines.length) {
    const next = lines[i];
    if (
      HEADING_ISSUE_RE.test(next) ||
      HEADING_ISSUE_SIMPLE_RE.test(next)
    ) {
      break;
    }
    if (SEPARATOR_RE.test(next) && bodyLines.length > 2) {
      break;
    }

    const labelMatch = next.match(/^labels:\s*(.+)$/i);
    if (labelMatch) {
      labels = [
        ...labels,
        ...labelMatch[1].split(",").map((l) => l.trim()),
      ];
      i++;
      continue;
    }

    const sectionMatch = next.match(/^\*\*File:\*\*\s*(.+)/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
    }

    bodyLines.push(next);
    i++;
  }

  const body = bodyLines.join("\n").trim();
  if (!body) return null;
  return { title, labels, body, section, _nextIndex: i };
}

function parseSeparatedBlock(
  lines: string[],
  start: number,
  defaultLabels: string[],
  headingLine: string,
): ParsedEntry | null {
  const headingMatch = headingLine.match(HEADING_BLOCK_RE);
  if (!headingMatch) return null;

  const title = headingMatch[1].trim();
  let labels: string[] = [...defaultLabels];
  let section = "";
  const bodyLines: string[] = [];

  let i = start + 1;
  while (i < lines.length) {
    const next = lines[i];

    const labelMatch = next.match(/^labels:\s*(.+)$/i);
    if (labelMatch) {
      labels = [
        ...labels,
        ...labelMatch[1].split(",").map((l) => l.trim()),
      ];
      i++;
      continue;
    }

    if (SEPARATOR_RE.test(next)) {
      i++;
      break;
    }

    if (HEADING_BLOCK_RE.test(next) && bodyLines.length > 1) {
      break;
    }

    const sectionMatch = next.match(/^\*\*File:\*\*\s*(.+)/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
    }

    bodyLines.push(next);
    i++;
  }

  const body = bodyLines.join("\n").trim();
  if (!body) return null;
  return { title, labels, body, section, _nextIndex: i };
}

function buildFullBody(
  entry: IssueEntry,
  filename: string,
  verbose: boolean,
): string {
  const parts: string[] = [];
  parts.push(entry.body);

  if (verbose && entry.section) {
    parts.push("");
    parts.push(`---`);
    parts.push(`Source: \`${filename}\``);
  }

  return parts.join("\n");
}

async function main() {
  const { dryRun, verbose, file: fileArg, defaultLabels } = parseArgs();

  if (!fileArg) {
    console.error(
      "Usage: npx tsx scripts/create-issues.ts [--dry-run] [--label=priority:p1,area:security] <file.md>",
    );
    process.exit(1);
  }

  const filePath = fs.existsSync(fileArg)
    ? fileArg
    : fileArg;

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const filename = filePath.split("/").pop() || filePath;

  if (!ghAvailable()) {
    console.error("gh CLI not authenticated. Run `gh auth login` first.");
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const issues = parseMarkdownIssues(content, defaultLabels);

  if (issues.length === 0) {
    console.log("No issues found in the file.");
    return;
  }

  const openTitles = getOpenIssueTitles();
  const existingLabels = getExistingLabels();

  console.log(
    `Found ${issues.length} issue${issues.length !== 1 ? "s" : ""} in ${filename}.`,
  );
  if (dryRun) console.log("DRY RUN — no issues will be created.\n");
  else console.log();

  let createdCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const entry of issues) {
    const normalizedTitle = entry.title.toLowerCase().trim();
    const duplicate = openTitles.get(normalizedTitle);

    if (duplicate !== undefined) {
      console.log(
        `SKIP (duplicate of #${duplicate}): ${entry.title}`,
      );
      skippedCount++;
      continue;
    }

    const defaultLabel = getDefaultLabel(entry.labels);
    const createdLabels = createMissingLabels(
      entry.labels,
      existingLabels,
      defaultLabel,
      dryRun,
      verbose,
    );

    if (createdLabels.length > 0 && verbose) {
      console.log(
        `  Labels to create: ${createdLabels.join(", ")}`,
      );
    }

    const body = buildFullBody(entry, filename, verbose);

    if (verbose) {
      console.log(
        `\n---\nIssue: ${entry.title}\nLabels: ${entry.labels.join(", ")}\nBody (${body.length} chars):`,
      );
      console.log(body.slice(0, 300));
      if (body.length > 300) console.log("...");
      console.log("---");
    }

    if (!dryRun) {
      try {
        const labelArgs =
          entry.labels.length > 0
            ? `--label "${entry.labels.join(",")}"`
            : "";

        const cmd = `gh issue create --title "${entry.title.replace(/"/g, '\\"')}" ${labelArgs} --body -`;

        execSync(cmd, {
          input: body,
          stdio: verbose ? "inherit" : ["pipe", "pipe", "pipe"],
        });

        console.log(`CREATED: ${entry.title}`);
        createdCount++;
      } catch (e: unknown) {
        const errMsg =
          e instanceof Error ? e.message : String(e);
        console.error(`FAILED: ${entry.title}`);
        console.error(`  ${errMsg}`);
        failedCount++;
      }
    } else {
      console.log(
        `[DRY RUN] Would create: ${entry.title} [${entry.labels.join(", ")}]`,
      );
      createdCount++;
    }
  }

  console.log();
  console.log(`Summary: ${createdCount} created, ${skippedCount} skipped (duplicates), ${failedCount} failed`);
  if (dryRun) console.log("Note: this was a dry run. Remove --dry-run to actually create issues.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
