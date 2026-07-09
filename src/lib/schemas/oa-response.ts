import { z } from "zod";

export const OATopicSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  score: z.number(),
  subfield: z.object({
    id: z.string(),
    display_name: z.string(),
  }).optional(),
  field: z.object({
    id: z.string(),
    display_name: z.string(),
  }).optional(),
});

export const OALocationSchema = z.object({
  source: z.object({
    display_name: z.string().optional(),
  }).optional().nullable(),
});

export const OAOpenAccessSchema = z.object({
  is_oa: z.boolean(),
  oa_status: z.string(),
  oa_url: z.string().nullable(),
});

export const OAWorkSchema = z.object({
  id: z.string(),
  doi: z.string(),
  title: z.string(),
  primary_location: OALocationSchema.nullable(),
  open_access: OAOpenAccessSchema,
  topics: z.array(OATopicSchema),
  abstract_inverted_index: z.record(z.string(), z.array(z.number())).nullable(),
  publication_date: z.string().nullable(),
});

export const OAResponseSchema = z.object({
  meta: z.object({
    count: z.number(),
    per_page: z.number(),
    page: z.number(),
  }),
  results: z.array(OAWorkSchema),
});

export type OAWork = z.infer<typeof OAWorkSchema>;
export type OAResponse = z.infer<typeof OAResponseSchema>;
export type OATopic = z.infer<typeof OATopicSchema>;

export const OAPaperRowSchema = z.object({
  id: z.string().uuid(),
  arxiv_id: z.string().nullable(),
  doi: z.string().nullable(),
  venue: z.string().nullable(),
  abstract: z.string().nullable(),
  is_open_access: z.boolean().nullable(),
  access: z.string(),
  ingested_at: z.string(),
});

export const OAPaperRowArraySchema = z.array(OAPaperRowSchema);

export type OAPaperRow = z.infer<typeof OAPaperRowSchema>;

export const OATopicIdRowSchema = z.object({
  id: z.string().uuid(),
});

export const OACursorSchema = z.object({
  cursor_value: z.string().nullable(),
  imported_count: z.number(),
}).nullable();
