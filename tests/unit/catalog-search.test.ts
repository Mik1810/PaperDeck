import assert from "node:assert/strict";
import test from "node:test";
import {
  SEARCH_PAGE_SIZE,
  normalizeSearchPage,
  searchPageOffset,
} from "../../src/lib/repositories/catalog-search";

test("search page size is 20", () => {
  assert.equal(SEARCH_PAGE_SIZE, 20);
});

test("normalizeSearchPage clamps invalid pages to 1", () => {
  assert.equal(normalizeSearchPage(1), 1);
  assert.equal(normalizeSearchPage(3), 3);
  assert.equal(normalizeSearchPage(0), 1);
  assert.equal(normalizeSearchPage(-5), 1);
  assert.equal(normalizeSearchPage(2.7), 2);
  assert.equal(normalizeSearchPage(Number.NaN), 1);
  assert.equal(normalizeSearchPage(Number.POSITIVE_INFINITY), 1);
});

test("searchPageOffset maps page numbers to zero-based offsets", () => {
  assert.equal(searchPageOffset(1), 0);
  assert.equal(searchPageOffset(2), SEARCH_PAGE_SIZE);
  assert.equal(searchPageOffset(3), SEARCH_PAGE_SIZE * 2);
  assert.equal(searchPageOffset(0), 0);
  assert.equal(searchPageOffset(-1), 0);
});
