import type { RecommendationEvaluationScenario } from "../../src/lib/ranking/stability-evaluation";
import type { Paper } from "../../src/types/paper";

const topics = ["theory", "systems", "ml"].map((id) => ({
  id,
  parentId: null,
}));

function paper(id: string, topicId: string): Paper {
  return {
    id,
    title: `Fixture paper ${id}`,
    authors: ["PaperDeck fixture"],
    year: 2024,
    source: "arXiv",
    abstract: "Versioned recommendation stability fixture.",
    topics: [{ id: topicId, label: topicId }],
    recommendationReason: "",
    url: `https://example.invalid/${id}`,
    access: "open",
  };
}

const papers = topics.flatMap(({ id }) =>
  Array.from({ length: 4 }, (_, index) => paper(`${id}-${index + 1}`, id)),
);

export const recommendationStabilityV1: RecommendationEvaluationScenario[] =
  topics.map(({ id }) => {
    const relevantPaperIds = papers
      .filter((candidate) => candidate.topics[0].id === id)
      .map((candidate) => candidate.id);

    return {
      id: `${id}-profile`,
      papers,
      topics,
      selectedTopicIds: [id],
      relevantPaperIds,
      semanticScores: Object.fromEntries(
        papers.map((candidate, index) => [
          candidate.id,
          candidate.topics[0].id === id ? 0.95 - index * 0.01 : 0.05,
        ]),
      ),
    };
  });
