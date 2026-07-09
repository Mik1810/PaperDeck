import { z } from "zod";

export const ArxivFeedSchema = z.object({
  feed: z.object({
    entry: z.union([
      z.array(z.record(z.string(), z.unknown())),
      z.record(z.string(), z.unknown()),
    ]).optional(),
  }).optional(),
});

export type ArxivFeed = z.infer<typeof ArxivFeedSchema>;

export const IngestionCursorSchema = z.object({
  cursor_value: z.string().nullable(),
  last_seen_published_at: z.string().nullable(),
  last_seen_external_id: z.string().nullable(),
}).nullable();

export type IngestionCursor = z.infer<typeof IngestionCursorSchema>;

export const TopicRowSchema = z.object({
  id: z.string().uuid(),
  arxiv_category: z.string().nullable(),
});

export const TopicRowArraySchema = z.array(TopicRowSchema);

export type TopicRow = z.infer<typeof TopicRowSchema>;

export const ArxivIdRowSchema = z.object({
  arxiv_id: z.string(),
});

export const SingleIdRowSchema = z.object({
  id: z.string().uuid(),
});
