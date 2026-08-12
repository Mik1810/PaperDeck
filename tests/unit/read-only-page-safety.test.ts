import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isMissingOwnerProfileError } from "../../src/lib/profile-bootstrap";

const pageSources = [
  "../../src/app/onboarding/page.tsx",
  "../../src/app/search/page.tsx",
  "../../src/app/settings/page.tsx",
].map((path) => ({
  path,
  source: readFileSync(new URL(path, import.meta.url), "utf8"),
}));

test("authenticated page renders contain no profile or identity bootstrap", () => {
  for (const { path, source } of pageSources) {
    assert.doesNotMatch(source, /ensureUserProfile/, path);
    assert.doesNotMatch(source, /ensureReadLaterPlaylist/, path);
    assert.doesNotMatch(source, /syncCollaborationIdentity/, path);
  }
});

test("profile fallback recognizes only guarded owner FK failures", () => {
  assert.equal(
    isMissingOwnerProfileError({
      code: "23503",
      constraint: "user_paper_interactions_owner_id_fkey",
    }),
    true,
  );
  assert.equal(
    isMissingOwnerProfileError({
      cause: {
        code: "23503",
        constraint: "playlists_owner_id_fkey",
      },
    }),
    true,
  );
  assert.equal(
    isMissingOwnerProfileError({
      code: "23503",
      constraint_name: "user_paper_interactions_owner_id_fkey",
    }),
    true,
  );
  assert.equal(
    isMissingOwnerProfileError({
      code: "23503",
      constraint: "playlist_items_paper_id_fkey",
    }),
    false,
  );
  assert.equal(
    isMissingOwnerProfileError({
      code: "23505",
      constraint: "playlists_owner_id_name_key",
    }),
    false,
  );
});
