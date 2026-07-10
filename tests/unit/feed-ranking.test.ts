import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { rankFeedPapers } from "../../src/lib/ranking/feed-ranking";
import type { Paper } from "../../src/types/paper";

function paper(overrides: Partial<Paper> & { id: string }): Paper {
  return {
    id: overrides.id,
    title: overrides.title ?? `Paper ${overrides.id}`,
    authors: overrides.authors ?? ["Ada Lovelace"],
    year: overrides.year ?? 2024,
    source: overrides.source ?? "arXiv",
    abstract: overrides.abstract ?? "Abstract",
    topics: overrides.topics ?? [{ id: "topic-a", label: "Topic A" }],
    recommendationReason: overrides.recommendationReason ?? "",
    url: overrides.url ?? `https://example.com/${overrides.id}`,
    citationCount: overrides.citationCount,
    isClassic: overrides.isClassic,
    access: overrides.access ?? "open",
    venue: overrides.venue,
    pdfUrl: overrides.pdfUrl,
    triageSummary: overrides.triageSummary,
  };
}

describe("rankFeedPapers score components", () => {
  test("exposes component scores whose sum matches the total score", () => {
    const ranked = rankFeedPapers(
      [
        paper({
          id: "paper-1",
          citationCount: 9,
          isClassic: true,
          topics: [{ id: "topic-a", label: "Topic A" }],
          year: 2022,
        }),
      ],
      [{ id: "topic-a", parentId: null }],
      new Set(["topic-a"]),
      {
        seenIds: new Set(),
        interactions: [{ action: "favorite", paperId: "paper-1" }],
      },
      new Map([["paper-1", 0.5]]),
    );

    const components = ranked[0].rankingScoreComponents;
    const componentTotal =
      components.semantic +
      components.topic +
      components.feedback +
      components.citation +
      components.recency +
      components.classic;

    assert.equal(components.source, "live");
    assert.equal(components.semantic, 60);
    assert.equal(components.topic, 90);
    assert.equal(components.feedback, 36);
    assert.equal(components.classic, 2);
    assert.ok(Math.abs(componentTotal - components.total) < 0.000001);
    assert.equal(ranked[0].rankingScore, components.total);
  });

  test("keeps higher semantic scores ahead when other signals match", () => {
    const ranked = rankFeedPapers(
      [
        paper({ id: "paper-low" }),
        paper({ id: "paper-high" }),
      ],
      [{ id: "topic-a", parentId: null }],
      new Set(["topic-a"]),
      {
        seenIds: new Set(),
        interactions: [],
      },
      new Map([
        ["paper-low", 0.1],
        ["paper-high", 0.9],
      ]),
    );

    assert.equal(ranked[0].id, "paper-high");
    assert.equal(ranked[0].rankingScoreComponents.semantic, 108);
  });

  test("uses already_read as positive feedback for related papers", () => {
    const ranked = rankFeedPapers(
      [
        paper({ id: "already-read", topics: [{ id: "topic-a", label: "Topic A" }] }),
        paper({ id: "candidate", topics: [{ id: "topic-a", label: "Topic A" }] }),
      ],
      [{ id: "topic-a", parentId: null }],
      new Set(),
      {
        seenIds: new Set(["already-read"]),
        interactions: [{ action: "already_read", paperId: "already-read" }],
      },
    );

    assert.equal(ranked[0].id, "candidate");
    assert.equal(ranked[0].rankingScoreComponents.feedback, 18);
    assert.match(ranked[0].recommendationReason, /recent Topic A feedback/);
  });
});
