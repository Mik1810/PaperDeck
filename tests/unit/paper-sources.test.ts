import assert from "node:assert/strict";
import test from "node:test";
import {
  knownPaperSources,
  paperSourceBadgeClassName,
  paperSourceFromDatabase,
  paperSourceToDatabase,
} from "../../src/lib/paper-sources";
import type { PaperSource } from "../../src/types/paper";

test("paperSourceFromDatabase maps all known database sources to display labels", () => {
  assert.equal(paperSourceFromDatabase("arxiv"), "arXiv");
  assert.equal(paperSourceFromDatabase("semantic_scholar"), "Semantic Scholar");
  assert.equal(paperSourceFromDatabase("openalex"), "OpenAlex");
  assert.equal(paperSourceFromDatabase("dblp"), "DBLP");
  assert.equal(paperSourceFromDatabase("crossref"), "Crossref");
  assert.equal(paperSourceFromDatabase("manual"), "Manual");
});

test("paperSourceFromDatabase uses a safe fallback for missing or future sources", () => {
  assert.equal(paperSourceFromDatabase(undefined), "Unknown");
  assert.equal(paperSourceFromDatabase(null), "Unknown");
  assert.equal(paperSourceFromDatabase("future_source"), "Unknown");
});

test("paperSourceToDatabase maps display labels back to database enum values", () => {
  assert.equal(paperSourceToDatabase("arXiv"), "arxiv");
  assert.equal(paperSourceToDatabase("Semantic Scholar"), "semantic_scholar");
  assert.equal(paperSourceToDatabase("OpenAlex"), "openalex");
  assert.equal(paperSourceToDatabase("DBLP"), "dblp");
  assert.equal(paperSourceToDatabase("Crossref"), "crossref");
  assert.equal(paperSourceToDatabase("Manual"), "manual");
});

test("paperSourceToDatabase rejects unknown display sources before persistence", () => {
  assert.throws(
    () => paperSourceToDatabase("Unknown"),
    /Cannot persist an unknown paper source/,
  );
});

test("paper source badge styles cover every visible source label", () => {
  const visibleSources: PaperSource[] = [...knownPaperSources, "Unknown"];

  for (const source of visibleSources) {
    assert.match(paperSourceBadgeClassName(source), /border-/);
    assert.match(paperSourceBadgeClassName(source), /text-/);
  }
});
