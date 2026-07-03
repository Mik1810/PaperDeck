import type {
  DatabasePaperSource,
  KnownPaperSource,
  PaperSource,
} from "@/types/paper";

export const knownPaperSources: KnownPaperSource[] = [
  "arXiv",
  "Semantic Scholar",
  "OpenAlex",
  "DBLP",
  "Crossref",
  "Manual",
];

const sourceToDatabase = {
  arXiv: "arxiv",
  "Semantic Scholar": "semantic_scholar",
  OpenAlex: "openalex",
  DBLP: "dblp",
  Crossref: "crossref",
  Manual: "manual",
} satisfies Record<KnownPaperSource, DatabasePaperSource>;

const sourceToDisplay = {
  arxiv: "arXiv",
  semantic_scholar: "Semantic Scholar",
  openalex: "OpenAlex",
  dblp: "DBLP",
  crossref: "Crossref",
  manual: "Manual",
} satisfies Record<DatabasePaperSource, KnownPaperSource>;

const paperSourceBadgeClassNames = {
  arXiv: "border-red-100 bg-red-50 text-red-700",
  "Semantic Scholar": "border-sky-100 bg-sky-50 text-sky-700",
  OpenAlex: "border-violet-100 bg-violet-50 text-violet-700",
  DBLP: "border-amber-100 bg-amber-50 text-amber-700",
  Crossref: "border-emerald-100 bg-emerald-50 text-emerald-700",
  Manual: "border-slate-200 bg-slate-100 text-slate-700",
  Unknown: "border-zinc-200 bg-zinc-100 text-zinc-700",
} satisfies Record<PaperSource, string>;

function isDatabasePaperSource(source: string): source is DatabasePaperSource {
  return source in sourceToDisplay;
}

export function paperSourceFromDatabase(source: string | null | undefined) {
  if (!source || !isDatabasePaperSource(source)) {
    return "Unknown";
  }

  return sourceToDisplay[source];
}

export function paperSourceToDatabase(source: PaperSource) {
  if (source === "Unknown") {
    throw new Error("Cannot persist an unknown paper source");
  }

  return sourceToDatabase[source];
}

export function paperSourceBadgeClassName(source: PaperSource) {
  return paperSourceBadgeClassNames[source];
}
