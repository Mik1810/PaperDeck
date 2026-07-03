export type TopicGranularity = "macro" | "category" | "micro";

export type TopicClassificationInput = {
  arxivCategory?: string | null;
  depth: number;
  label: string;
  parentId?: string | null;
  slug?: string | null;
  source?: string | null;
};

export type TopicMacroGroup = {
  description: string;
  id: string;
  label: string;
};

export const topicMacroGroups: TopicMacroGroup[] = [
  {
    id: "ai-data",
    label: "AI, Language & Data",
    description: "Learning, vision, language, retrieval, robotics.",
  },
  {
    id: "theory",
    label: "Theory & Algorithms",
    description: "Complexity, logic, algorithms, formal models.",
  },
  {
    id: "systems",
    label: "Systems & Infrastructure",
    description: "Architecture, networks, operating systems, control.",
  },
  {
    id: "software-security",
    label: "Software & Security",
    description: "Programming languages, engineering, cryptography.",
  },
  {
    id: "human-media",
    label: "People, Society & Media",
    description: "HCI, society, graphics, sound, multimedia.",
  },
  {
    id: "other-cs",
    label: "Other CS",
    description: "General or uncategorized computer science.",
  },
];

export const topicMacroGroupIds = topicMacroGroups.map((group) => group.id);

const categoryMacroMap: Record<string, string> = {
  "cs.AI": "ai-data",
  "cs.CL": "ai-data",
  "cs.CV": "ai-data",
  "cs.DB": "ai-data",
  "cs.IR": "ai-data",
  "cs.LG": "ai-data",
  "cs.MA": "ai-data",
  "cs.NE": "ai-data",
  "cs.RO": "ai-data",
  "cs.CC": "theory",
  "cs.CG": "theory",
  "cs.DM": "theory",
  "cs.DS": "theory",
  "cs.FL": "theory",
  "cs.GT": "theory",
  "cs.IT": "theory",
  "cs.LO": "theory",
  "cs.NA": "theory",
  "cs.SC": "theory",
  "cs.AR": "systems",
  "cs.CE": "systems",
  "cs.DC": "systems",
  "cs.ET": "systems",
  "cs.MS": "systems",
  "cs.NI": "systems",
  "cs.OS": "systems",
  "cs.PF": "systems",
  "cs.SY": "systems",
  "cs.CR": "software-security",
  "cs.PL": "software-security",
  "cs.SE": "software-security",
  "cs.CY": "human-media",
  "cs.DL": "human-media",
  "cs.GL": "human-media",
  "cs.GR": "human-media",
  "cs.HC": "human-media",
  "cs.MM": "human-media",
  "cs.SD": "human-media",
  "cs.SI": "human-media",
  "cs.OH": "other-cs",
};

const keywordMacroRules: Array<{ id: string; patterns: RegExp[] }> = [
  {
    id: "software-security",
    patterns: [/security/, /verification/, /programming/, /software/, /type system/],
  },
  {
    id: "ai-data",
    patterns: [
      /artificial intelligence/,
      /audio/,
      /data mining/,
      /language/,
      /machine learning/,
      /neural/,
      /reinforcement/,
      /robot/,
      /speech/,
      /vision/,
    ],
  },
  {
    id: "theory",
    patterns: [
      /algorithm/,
      /automata/,
      /cohomology/,
      /complexity/,
      /formal/,
      /graph/,
      /logic/,
      /optimization/,
      /search/,
      /semigroup/,
    ],
  },
  {
    id: "systems",
    patterns: [
      /architecture/,
      /distributed/,
      /logistics/,
      /manufacturing/,
      /network/,
      /parallel/,
      /real-time/,
      /scheduling/,
      /system/,
    ],
  },
  {
    id: "human-media",
    patterns: [/human/, /media/, /music/, /society/, /sound/, /web/],
  },
];

const broadSeedMacroSlugs = new Set(["theory"]);
const seedMicroSlugs = new Set(["llm"]);

export function topicGranularity(topic: TopicClassificationInput): TopicGranularity {
  if (topic.depth >= 2 || seedMicroSlugs.has(topic.slug ?? "")) {
    return "micro";
  }

  if (topic.depth === 1 || topic.parentId) {
    return "category";
  }

  if (topic.source === "openalex") {
    return "micro";
  }

  if (broadSeedMacroSlugs.has(topic.slug ?? "")) {
    return "macro";
  }

  return "category";
}

export function isDefaultOnboardingTopic(topic: TopicClassificationInput) {
  return topicGranularity(topic) !== "micro";
}

export function macroIdsForTopic(topic: TopicClassificationInput) {
  const categoryMacro = topic.arxivCategory
    ? categoryMacroMap[topic.arxivCategory]
    : undefined;

  if (categoryMacro) {
    return [categoryMacro];
  }

  const haystack = `${topic.slug ?? ""} ${topic.label}`.toLowerCase();
  const matched = keywordMacroRules
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(haystack)))
    .map((rule) => rule.id);

  return matched.length ? [...new Set(matched)] : ["other-cs"];
}

export function topicMatchesMacro(
  topic: TopicClassificationInput,
  macroIds: Set<string>,
) {
  if (!macroIds.size) {
    return true;
  }

  return macroIdsForTopic(topic).some((id) => macroIds.has(id));
}

export function macroIdsFromTopics(topics: TopicClassificationInput[]) {
  return [...new Set(topics.flatMap((topic) => macroIdsForTopic(topic)))];
}
