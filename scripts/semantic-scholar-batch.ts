import type { ProviderDecision } from "./enrichment-outcomes";
import type { S2Paper, S2PaperRow } from "../src/lib/schemas/s2-paper";

export function mapS2BatchResults(
  papers: Pick<S2PaperRow, "id">[],
  results: (S2Paper | null)[],
) {
  return new Map<string, ProviderDecision<S2Paper>>(
    papers.map((paper, index) => {
      const result = results[index];

      return [
        paper.id,
        result
          ? { outcome: "found" as const, value: result }
          : { outcome: "not_found" as const },
      ];
    }),
  );
}
