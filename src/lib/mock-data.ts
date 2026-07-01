import type { Paper, PaperTopic, Playlist, UserInterest } from "@/types/paper";

export const topicTree: PaperTopic[] = [
  { id: "theory", label: "Theoretical CS" },
  {
    id: "complexity",
    label: "Computational Complexity",
    parentId: "theory",
    arxivCategory: "cs.CC",
  },
  {
    id: "algorithms",
    label: "Algorithms",
    parentId: "theory",
    arxivCategory: "cs.DS",
  },
  {
    id: "approximation",
    label: "Approximation Algorithms",
    parentId: "algorithms",
  },
  {
    id: "parallel",
    label: "Parallel Algorithms",
    parentId: "algorithms",
  },
  {
    id: "pl",
    label: "Programming Languages",
    arxivCategory: "cs.PL",
  },
  { id: "types", label: "Type Systems", parentId: "pl" },
  { id: "formal-methods", label: "Formal Methods", parentId: "pl" },
  { id: "llm", label: "Large Language Models", arxivCategory: "cs.CL" },
  { id: "ir", label: "Information Retrieval", arxivCategory: "cs.IR" },
];

export const userInterests: UserInterest[] = [
  { id: "complexity", label: "Computational Complexity", depth: 2, selected: true },
  { id: "algorithms", label: "Algorithms", depth: 2, selected: true },
  { id: "pl", label: "Programming Languages", depth: 1, selected: true },
  { id: "llm", label: "Large Language Models", depth: 1, selected: false },
  { id: "ir", label: "Information Retrieval", depth: 1, selected: false },
];

const byId = new Map(topicTree.map((topic) => [topic.id, topic]));

const topics = (...ids: string[]) =>
  ids.map((id) => {
    const topic = byId.get(id);

    if (!topic) {
      throw new Error(`Missing mock topic: ${id}`);
    }

    return topic;
  });

export const mockPapers: Paper[] = [
  {
    id: "paper-001",
    title:
      "Fine-Grained Lower Bounds for Dynamic Graph Problems Under Online Matrix-Vector Multiplication",
    authors: ["Amir Abboud", "Virginia Vassilevska Williams"],
    year: 2014,
    source: "arXiv",
    venue: "STOC-adjacent preprint",
    abstract:
      "We study dynamic graph problems through the lens of fine-grained complexity. Assuming the online matrix-vector multiplication conjecture, we derive conditional lower bounds for update and query times in several dynamic settings. The results connect classic reductions with modern data structure barriers and clarify which tradeoffs are unlikely to be improved by polylogarithmic factors.",
    topics: topics("complexity", "algorithms"),
    recommendationReason:
      "Matches your complexity and algorithms interests, with a classic-paper boost kept under the daily cap.",
    url: "https://arxiv.org/",
    citationCount: 820,
    isClassic: true,
    access: "open",
  },
  {
    id: "paper-002",
    title:
      "A Typed Intermediate Language for Modular Program Verification",
    authors: ["Nadia Polikarpova", "Andrew C. Myers"],
    year: 2021,
    source: "Semantic Scholar",
    venue: "POPL",
    abstract:
      "This paper presents a typed intermediate language designed to preserve modular reasoning principles through compilation. The core calculus tracks effects, ownership, and refinement obligations so that downstream verification tools can consume a uniform representation without losing source-level structure. We discuss soundness, implementation constraints, and evaluation on representative verification workloads.",
    topics: topics("pl", "types", "formal-methods"),
    recommendationReason:
      "Strong overlap with programming languages, type systems, and formal methods.",
    url: "https://www.semanticscholar.org/",
    citationCount: 74,
    access: "publisher",
  },
  {
    id: "paper-003",
    title: "Parallel Approximation Schemes for Massive Graph Clustering",
    authors: ["Anupam Gupta", "Kunal Talwar", "Sergei Vassilvitskii"],
    year: 2025,
    source: "OpenAlex",
    venue: "SODA",
    abstract:
      "We give parallel approximation schemes for clustering objectives on massive graphs with bounded communication rounds. The algorithms combine sparsification, locality-sensitive primitives, and randomized rounding. For several common objectives, the approximation ratios match the best known sequential guarantees while achieving practical speedups on distributed inputs.",
    topics: topics("algorithms", "approximation", "parallel"),
    recommendationReason:
      "A recent algorithmic paper near your approximation and parallelism interests.",
    url: "https://openalex.org/",
    citationCount: 12,
    access: "unknown",
  },
  {
    id: "paper-004",
    title:
      "Retrieval-Augmented Language Models for Scientific Recommendation",
    authors: ["Yizhe Zhang", "Mina Lee", "Christopher Manning"],
    year: 2026,
    source: "arXiv",
    abstract:
      "We investigate retrieval-augmented language models for recommending scientific literature from sparse user feedback. The system combines topic priors, dense retrieval, and calibrated reranking to balance novelty with relevance. Experiments on computer science corpora show improvements over popularity-based and citation-based baselines, especially for users with niche theoretical interests.",
    topics: topics("llm", "ir", "algorithms"),
    recommendationReason:
      "Exploratory recommendation: close to PaperDeck's future RAG direction and adjacent to your selected topics.",
    url: "https://arxiv.org/",
    citationCount: 3,
    access: "open",
  },
];

export const mockPlaylists: Playlist[] = [
  {
    id: "read-later",
    name: "Read later",
    paperIds: ["paper-002", "paper-003"],
  },
  {
    id: "complexity-classics",
    name: "Complexity classics",
    paperIds: ["paper-001"],
  },
];
