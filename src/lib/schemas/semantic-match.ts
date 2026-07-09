import { z } from "zod";

export const SemanticMatchRowSchema = z.object({
  paper_id: z.string().uuid(),
  semantic_score: z.number(),
});

export type SemanticMatchRow = z.infer<typeof SemanticMatchRowSchema>;

export const SemanticMatchRowArraySchema = z.array(SemanticMatchRowSchema);
