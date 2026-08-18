import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repositorySource = readFileSync(
  new URL("../../src/lib/repositories/catalog.ts", import.meta.url),
  "utf8",
);

function functionSource(name: string, nextMarker: string) {
  const start = repositorySource.indexOf(`async function ${name}`);
  const end = repositorySource.indexOf(nextMarker, start);

  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${name} should have a readable boundary`);

  return repositorySource.slice(start, end);
}

test("paper authors and topics hydrate concurrently through one bounded helper", () => {
  const associations = functionSource(
    "getPaperAssociations",
    "/** @admin */\nexport async function getTopics",
  );
  const papersByIds = functionSource(
    "getPapersByIds",
    "/** @admin */\nexport async function getRankingCandidatesByIds",
  );

  assert.match(associations, /await Promise\.all\(\[/);
  assert.equal(associations.match(/\.from\(paperAuthors\)/g)?.length, 1);
  assert.equal(associations.match(/\.from\(paperTopics\)/g)?.length, 1);
  assert.match(papersByIds, /await getPaperAssociations\(paperIdsFound\)/);
  assert.equal(repositorySource.match(/getPaperAssociations\(/g)?.length, 3);
});
