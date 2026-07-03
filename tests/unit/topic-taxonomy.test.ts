import assert from "node:assert/strict";
import test from "node:test";
import {
  arxivCategoryLabel,
  topicDisplayLabel,
} from "../../src/lib/arxiv-categories";
import {
  isDefaultOnboardingTopic,
  macroIdsForTopic,
  topicGranularity,
} from "../../src/lib/topic-taxonomy";

test("arxivCategoryLabel maps CS category codes to display labels", () => {
  assert.equal(arxivCategoryLabel("cs.AR"), "Hardware Architecture");
  assert.equal(
    arxivCategoryLabel("cs.CV"),
    "Computer Vision and Pattern Recognition",
  );
  assert.equal(arxivCategoryLabel("cs.NI"), "Networking and Internet Architecture");
});

test("topicDisplayLabel hides raw arXiv category codes", () => {
  assert.equal(
    topicDisplayLabel({ arxivCategory: "cs.CV", label: "cs.CV" }),
    "Computer Vision and Pattern Recognition",
  );
  assert.equal(
    topicDisplayLabel({ arxivCategory: "cs.LG", label: "Machine Learning" }),
    "Machine Learning",
  );
});

test("topicGranularity classifies hierarchy and flat enrichment topics", () => {
  assert.equal(
    topicGranularity({
      arxivCategory: null,
      depth: 0,
      label: "Theoretical CS",
      slug: "theory",
      source: "paperdeck_seed",
    }),
    "macro",
  );
  assert.equal(
    topicGranularity({
      arxivCategory: "cs.PL",
      depth: 0,
      label: "Programming Languages",
      slug: "cs-pl",
      source: "arxiv",
    }),
    "category",
  );
  assert.equal(
    topicGranularity({
      arxivCategory: null,
      depth: 0,
      label: "Adversarial Robustness in Machine Learning",
      slug: "openalex:T11689",
      source: "openalex",
    }),
    "micro",
  );
});

test("isDefaultOnboardingTopic keeps Not now broad instead of micro-specific", () => {
  assert.equal(
    isDefaultOnboardingTopic({
      arxivCategory: null,
      depth: 0,
      label: "Theoretical CS",
      slug: "theory",
      source: "paperdeck_seed",
    }),
    true,
  );
  assert.equal(
    isDefaultOnboardingTopic({
      arxivCategory: "cs.PL",
      depth: 0,
      label: "Programming Languages",
      slug: "cs-pl",
      source: "arxiv",
    }),
    true,
  );
  assert.equal(
    isDefaultOnboardingTopic({
      arxivCategory: null,
      depth: 0,
      label: "Adversarial Robustness in Machine Learning",
      slug: "openalex:T11689",
      source: "openalex",
    }),
    false,
  );
});

test("macroIdsForTopic maps arXiv and keyword-only topics to macro groups", () => {
  assert.deepEqual(
    macroIdsForTopic({
      arxivCategory: "cs.CR",
      depth: 0,
      label: "Cryptography and Security",
    }),
    ["software-security"],
  );
  assert.deepEqual(
    macroIdsForTopic({
      depth: 0,
      label: "Speech and Audio Processing",
      source: "openalex",
    }),
    ["ai-data"],
  );
});
