import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { describe } from "node:test";
import {
  SEARCH_PAGE_SIZE,
  decodeCatalogSearchCursor,
  encodeCatalogSearchCursor,
  InvalidCatalogSearchCursorError,
} from "../../src/lib/repositories/catalog-search";

const paperId = "00000000-0000-4000-8000-000000000176";
const query = "graph neural networks";
const repositorySource = readFileSync(
  new URL("../../src/lib/repositories/catalog.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL(
    "../../supabase/migrations/20260812200000_complete_catalog_search_indexes.sql",
    import.meta.url,
  ),
  "utf8",
);

test("search page size is 20", () => {
  assert.equal(SEARCH_PAGE_SIZE, 20);
});

describe("Catalog search cursors", () => {
  test("round-trips a query-bound next boundary", () => {
    const encoded = encodeCatalogSearchCursor(
      {
        direction: "next",
        id: paperId,
        page: 3,
        rank: 0.125,
        year: 2025,
      },
      query,
    );

    assert.deepEqual(decodeCatalogSearchCursor(encoded, query), {
      direction: "next",
      id: paperId,
      page: 3,
      queryHash: "23995655dd481fea4ae4225788c7255f",
      rank: 0.125,
      version: 1,
      year: 2025,
    });
  });

  test("supports previous boundaries and null publication years", () => {
    const encoded = encodeCatalogSearchCursor(
      {
        direction: "previous",
        id: paperId,
        page: 1,
        rank: 0,
        year: null,
      },
      query,
    );

    assert.equal(
      decodeCatalogSearchCursor(encoded, query)?.direction,
      "previous",
    );
    assert.equal(decodeCatalogSearchCursor(encoded, query)?.year, null);
  });

  test("rejects another query, malformed data, and invalid boundaries", () => {
    const encoded = encodeCatalogSearchCursor(
      {
        direction: "next",
        id: paperId,
        page: 2,
        rank: 0,
        year: 2025,
      },
      query,
    );

    assert.throws(
      () => decodeCatalogSearchCursor(encoded, "different query"),
      InvalidCatalogSearchCursorError,
    );
    assert.throws(
      () => decodeCatalogSearchCursor("not_json", query),
      InvalidCatalogSearchCursorError,
    );
    assert.throws(
      () => decodeCatalogSearchCursor("a".repeat(513), query),
      InvalidCatalogSearchCursorError,
    );
  });
});

test("catalog search uses indexable branches and no OFFSET", () => {
  assert.match(repositorySource, /candidate_matches as materialized/);
  assert.match(repositorySource, /union all/);
  assert.match(repositorySource, /scored\.rank < \$\{cursor\.rank\}/);
  assert.doesNotMatch(repositorySource, /searchPageOffset|\.offset\(/);
  assert.doesNotMatch(repositorySource, /coalesce\(\$\{papers\.(arxivId|doi)\}/);

  assert.match(migrationSource, /papers_arxiv_id_trgm_idx/);
  assert.match(migrationSource, /papers_doi_trgm_idx/);
  assert.doesNotMatch(migrationSource, /taxonomy_topics_label_trgm_idx/);
});
