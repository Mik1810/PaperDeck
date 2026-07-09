import { z } from "zod";

export const S2ExternalIdsSchema = z.object({
  ArXiv: z.string().optional(),
  DOI: z.string().optional(),
  MAG: z.string().optional(),
  CorpusId: z.number().optional(),
});

export const S2OpenAccessPdfSchema = z.object({
  url: z.string(),
  status: z.string(),
});

export const S2PaperSchema = z.object({
  paperId: z.string(),
  externalIds: S2ExternalIdsSchema,
  citationCount: z.number().optional().default(0),
  year: z.number().nullable(),
  venue: z.string().optional().default(""),
  title: z.string(),
  url: z.string(),
  publicationDate: z.string().nullable(),
  openAccessPdf: S2OpenAccessPdfSchema.nullable(),
});

export const S2BatchResponseSchema = z.array(S2PaperSchema.nullable());

export type S2Paper = z.infer<typeof S2PaperSchema>;

export const S2PaperRowSchema = z.object({
  id: z.string().uuid(),
  arxiv_id: z.string(),
  doi: z.string().nullable(),
  venue: z.string().nullable(),
  year: z.number().nullable(),
  ingested_at: z.string(),
});

export const S2PaperRowArraySchema = z.array(S2PaperRowSchema);

export type S2PaperRow = z.infer<typeof S2PaperRowSchema>;

export const S2CursorSchema = z.object({
  cursor_value: z.string().nullable(),
  imported_count: z.number(),
}).nullable();
