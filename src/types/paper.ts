import type { Enums } from "@/types/database";

export type DatabasePaperSource = Enums<"paper_source">;

export type KnownPaperSource =
  | "arXiv"
  | "Semantic Scholar"
  | "OpenAlex"
  | "DBLP"
  | "Crossref"
  | "Manual";

export type PaperSource = KnownPaperSource | "Unknown";

export type PaperAccess = Enums<"paper_access">;

export type PaperTopic = {
  id: string;
  label: string;
  parentId?: string;
  arxivCategory?: string;
};

export type TriageSummary = {
  why_it_matters: string;
  main_contribution: string;
  prerequisites: string;
  read_if_you_care_about: string;
};

export type Paper = {
  id: string;
  title: string;
  authors: string[];
  year: number;
  source: PaperSource;
  venue?: string;
  abstract: string;
  topics: PaperTopic[];
  recommendationReason: string;
  url: string;
  pdfUrl?: string;
  citationCount?: number;
  isClassic?: boolean;
  access: PaperAccess;
  triageSummary?: TriageSummary;
};

export type UserInterest = {
  id: string;
  label: string;
  depth: number;
  selected: boolean;
};

export type Playlist = {
  id: string;
  name: string;
  paperIds: string[];
  isDefault?: boolean;
};

export type InteractionType = Enums<"interaction_type">;
