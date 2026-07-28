import type { RecommendationEvaluationScenario } from "../../src/lib/ranking/stability-evaluation";
import type { Paper } from "../../src/types/paper";

const topicDefinitions: Array<[string, string | null]> = [
  ["ai", null],
  ["ml", "ai"],
  ["nlp", "ai"],
  ["agents", "ai"],
  ["systems", null],
  ["security", "systems"],
  ["databases", "systems"],
  ["hci", null],
  ["vision", "ai"],
  ["theory", null],
];

const topics = topicDefinitions.map(([id, parentId]) => ({ id, parentId }));

type PaperDefinition = {
  id: string;
  topicIds: string[];
  year: number;
  citationCount: number;
  isClassic?: boolean;
};

function paper(definition: PaperDefinition): Paper {
  return {
    id: definition.id,
    title: `Fixture paper ${definition.id}`,
    authors: ["PaperDeck fixture"],
    year: definition.year,
    citationCount: definition.citationCount,
    isClassic: definition.isClassic,
    source: "arXiv",
    abstract: "Challenging recommendation stability fixture.",
    topics: definition.topicIds.map((id) => ({ id, label: id })),
    recommendationReason: "",
    url: `https://example.invalid/${definition.id}`,
    access: "open",
  };
}

const papers = [
  { id: "agent-security", topicIds: ["agents", "security"], year: 2026, citationCount: 50 },
  { id: "prompt-injection", topicIds: ["security", "nlp"], year: 2025, citationCount: 200 },
  { id: "agent-memory", topicIds: ["agents", "ml"], year: 2026, citationCount: 20 },
  { id: "agent-benchmark", topicIds: ["agents"], year: 2026, citationCount: 5 },
  { id: "database-agent", topicIds: ["databases", "agents"], year: 2026, citationCount: 10 },
  { id: "postgres-optimizer", topicIds: ["databases"], year: 2024, citationCount: 400 },
  { id: "db-theory-classic", topicIds: ["databases", "theory"], year: 2012, citationCount: 5000, isClassic: true },
  { id: "cloud-security", topicIds: ["security"], year: 2025, citationCount: 500 },
  { id: "llm-safety-survey", topicIds: ["nlp", "security"], year: 2026, citationCount: 1000 },
  { id: "multimodal-medical", topicIds: ["vision", "ml"], year: 2026, citationCount: 30 },
  { id: "efficient-vision", topicIds: ["vision", "systems"], year: 2025, citationCount: 120 },
  { id: "clinical-speech", topicIds: ["ml", "hci"], year: 2024, citationCount: 80 },
  { id: "graph-algorithms", topicIds: ["theory"], year: 2023, citationCount: 300 },
  { id: "transformer-theory", topicIds: ["theory", "ml"], year: 2025, citationCount: 150 },
  { id: "popular-llm", topicIds: ["nlp"], year: 2026, citationCount: 10000 },
  { id: "obscure-systems", topicIds: ["systems"], year: 2026, citationCount: 0 },
  { id: "shared-ai-systems", topicIds: ["ml", "systems"], year: 2025, citationCount: 90 },
  { id: "unrelated-hci", topicIds: ["hci"], year: 2026, citationCount: 200 },
  { id: "db-seed", topicIds: ["databases"], year: 2022, citationCount: 20 },
  { id: "vision-seed", topicIds: ["vision"], year: 2022, citationCount: 20 },
  { id: "theory-seed", topicIds: ["theory"], year: 2022, citationCount: 20 },
].map(paper);

export const recommendationStabilityV2: RecommendationEvaluationScenario[] = [
  {
    id: "agent-security",
    papers,
    topics,
    selectedTopicIds: ["agents", "security"],
    seenPaperIds: ["agent-benchmark", "popular-llm"],
    interactions: [
      { paperId: "agent-benchmark", action: "favorite" },
      { paperId: "popular-llm", action: "not_interested" },
    ],
    relevanceGrades: {
      "agent-security": 3,
      "prompt-injection": 3,
      "agent-memory": 2,
      "database-agent": 2,
      "cloud-security": 1,
      "llm-safety-survey": 1,
    },
    semanticScores: {
      "agent-security": 0.7,
      "prompt-injection": 0.6,
      "agent-memory": 0.88,
      "database-agent": 0.55,
      "cloud-security": 0.75,
      "llm-safety-survey": 0.82,
      "shared-ai-systems": 0.78,
    },
  },
  {
    id: "database-systems",
    papers,
    topics,
    selectedTopicIds: ["databases"],
    seenPaperIds: ["db-seed"],
    interactions: [{ paperId: "db-seed", action: "favorite" }],
    relevanceGrades: {
      "postgres-optimizer": 3,
      "database-agent": 3,
      "db-theory-classic": 2,
      "shared-ai-systems": 2,
      "obscure-systems": 1,
    },
    semanticScores: {
      "postgres-optimizer": 0.65,
      "database-agent": 0.8,
      "db-theory-classic": 0.5,
      "shared-ai-systems": 0.75,
      "obscure-systems": 0.4,
      "agent-security": 0.72,
    },
  },
  {
    id: "multimodal-health",
    papers,
    topics,
    selectedTopicIds: ["vision", "ml"],
    seenPaperIds: ["vision-seed"],
    interactions: [{ paperId: "vision-seed", action: "favorite" }],
    relevanceGrades: {
      "multimodal-medical": 3,
      "clinical-speech": 3,
      "efficient-vision": 2,
      "shared-ai-systems": 1,
      "transformer-theory": 1,
    },
    semanticScores: {
      "multimodal-medical": 0.65,
      "clinical-speech": 0.6,
      "efficient-vision": 0.8,
      "shared-ai-systems": 0.7,
      "transformer-theory": 0.78,
      "llm-safety-survey": 0.85,
    },
  },
  {
    id: "theory",
    papers,
    topics,
    selectedTopicIds: ["theory"],
    seenPaperIds: ["theory-seed", "agent-memory"],
    interactions: [
      { paperId: "theory-seed", action: "favorite" },
      { paperId: "agent-memory", action: "not_interested" },
    ],
    relevanceGrades: {
      "graph-algorithms": 3,
      "transformer-theory": 3,
      "db-theory-classic": 2,
      "postgres-optimizer": 1,
    },
    semanticScores: {
      "graph-algorithms": 0.62,
      "transformer-theory": 0.72,
      "db-theory-classic": 0.55,
      "postgres-optimizer": 0.75,
      "popular-llm": 0.9,
      "shared-ai-systems": 0.7,
    },
  },
];
