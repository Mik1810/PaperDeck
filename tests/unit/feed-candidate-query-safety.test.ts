import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = process.cwd();

test("live feed uses bounded candidates instead of a full catalog hydration", async () => {
  const userDataSource = await readFile(
    path.join(repositoryRoot, "src/lib/repositories/user-data.ts"),
    "utf8",
  );
  const catalogSource = await readFile(
    path.join(repositoryRoot, "src/lib/repositories/catalog.ts"),
    "utf8",
  );

  assert.doesNotMatch(userDataSource, /getAllPapers/);
  assert.doesNotMatch(catalogSource, /export async function getAllPapers/);
  assert.match(catalogSource, /CATALOG_RANKING_CANDIDATE_LIMIT = 300/);
  assert.match(catalogSource, /select\(paperPresentationSelection\)/);
  assert.match(catalogSource, /union all/);
  assert.match(userDataSource, /paper_hydration/);
});
