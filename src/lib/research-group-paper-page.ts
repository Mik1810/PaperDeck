import type { Paper } from "@/types/paper";

export const RESEARCH_GROUP_PAPER_PAGE_SIZE = 40;

export type ResearchGroupPaperPageItem = {
  paper: Paper;
  contributor: {
    publicId: string;
    displayName: string | null;
    imageUrl: string | null;
  } | null;
  addedAt: string;
  canRemove: boolean;
};

export type ResearchGroupPaperPage = {
  items: ResearchGroupPaperPageItem[];
  nextCursor: string | null;
  totalCount: number;
};
