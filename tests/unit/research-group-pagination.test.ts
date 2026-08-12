import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { describe } from "node:test";
import {
  decodeResearchGroupPaperCursor,
  encodeResearchGroupPaperCursor,
  InvalidResearchGroupPaperCursorError,
} from "../../src/lib/repositories/research-group-cursor";

const paperId = "00000000-0000-4000-8000-000000000175";
const repositorySource = readFileSync(
  new URL(
    "../../src/lib/repositories/research-group-workspace.ts",
    import.meta.url,
  ),
  "utf8",
);

describe("Research-group paper cursors", () => {
  test("round-trips an added-at and paper-id keyset boundary", () => {
    const cursor = {
      addedAt: "2026-08-12T10:00:00.000Z",
      paperId,
      version: 1 as const,
    };

    assert.deepEqual(
      decodeResearchGroupPaperCursor(
        encodeResearchGroupPaperCursor(cursor),
      ),
      cursor,
    );
  });

  test("rejects malformed, oversized, and invalid boundaries", () => {
    assert.throws(
      () => decodeResearchGroupPaperCursor("not_json"),
      InvalidResearchGroupPaperCursorError,
    );
    assert.throws(
      () => decodeResearchGroupPaperCursor("a".repeat(513)),
      InvalidResearchGroupPaperCursorError,
    );
    assert.throws(
      () =>
        decodeResearchGroupPaperCursor(
          Buffer.from(
            JSON.stringify({
              addedAt: "not-a-date",
              paperId: "not-a-uuid",
              version: 1,
            }),
          ).toString("base64url"),
        ),
      InvalidResearchGroupPaperCursorError,
    );
  });
});

test("research-group pages use an index-compatible keyset without OFFSET", () => {
  assert.match(
    repositorySource,
    /group_paper\.added_at < \$\{cursor\.addedAt\}::timestamptz/,
  );
  assert.match(
    repositorySource,
    /group_paper\.paper_id > \$\{cursor\.paperId\}::uuid/,
  );
  assert.match(
    repositorySource,
    /order by group_paper\.added_at desc, group_paper\.paper_id/,
  );
  assert.match(
    repositorySource,
    /RESEARCH_GROUP_PAPER_PAGE_SIZE \+ 1/,
  );
  assert.doesNotMatch(repositorySource, /\boffset\b/i);
});
