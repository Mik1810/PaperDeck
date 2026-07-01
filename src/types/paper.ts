export type PaperSource = "arXiv" | "Semantic Scholar" | "OpenAlex" | "DBLP";

export type PaperAccess = "open" | "publisher" | "unknown";

export type PaperTopic = {
  id: string;
  label: string;
  parentId?: string;
  arxivCategory?: string;
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
};

export type InteractionType =
  | "open_detail"
  | "dismiss"
  | "favorite"
  | "save_to_playlist"
  | "read"
  | "seen";
