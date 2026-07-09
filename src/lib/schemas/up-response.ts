import { z } from "zod";

export const UPLocationSchema = z.object({
  url: z.string().nullable(),
  url_for_pdf: z.string().nullable(),
  url_for_landing_page: z.string().nullable(),
  host_type: z.string().nullable(),
  version: z.string().nullable(),
  license: z.string().nullable(),
});

export const UPResponseSchema = z.object({
  doi: z.string(),
  is_oa: z.boolean(),
  oa_status: z.string(),
  best_oa_location: UPLocationSchema.nullable(),
  oa_locations: z.array(UPLocationSchema),
});

export type UPLocation = z.infer<typeof UPLocationSchema>;
export type UPResponse = z.infer<typeof UPResponseSchema>;

export const UPPaperRowSchema = z.object({
  id: z.string().uuid(),
  arxiv_id: z.string().nullable(),
  doi: z.string().nullable(),
  is_open_access: z.boolean().nullable(),
  pdf_url: z.string().nullable(),
  ingested_at: z.string(),
});

export const UPPaperRowArraySchema = z.array(UPPaperRowSchema);

export type UPPaperRow = z.infer<typeof UPPaperRowSchema>;

export const UPCursorSchema = z.object({
  cursor_value: z.string().nullable(),
  imported_count: z.number(),
}).nullable();
