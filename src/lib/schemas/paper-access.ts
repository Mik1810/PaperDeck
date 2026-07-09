import { z } from "zod";

export const PaperAccessSchema = z.enum(["open", "publisher", "unknown"]);

export type PaperAccess = z.infer<typeof PaperAccessSchema>;

export const TriageSummarySchema = z.object({
  why_it_matters: z.string(),
  main_contribution: z.string(),
  prerequisites: z.string(),
  read_if_you_care_about: z.string(),
});

export type TriageSummary = z.infer<typeof TriageSummarySchema>;
