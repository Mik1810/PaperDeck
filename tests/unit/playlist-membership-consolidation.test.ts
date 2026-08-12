import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const repositorySource = source("src/lib/repositories/user-data.ts");
const legacyRepositorySource = source(
  "src/lib/repositories/playlist-items.ts",
);
const actionsSource = source("src/app/actions.ts");
const deckRouteSource = source("src/app/api/deck/route.ts");
const pickerSource = source("src/components/playlist-picker.tsx");
const schemaSource = source("src/db/schema.ts");
const feedSource = source("src/components/paper-card.tsx");
const digestSource = source("src/app/digest/page.tsx");
const detailSource = source("src/components/paper-detail-actions.tsx");
const groupSource = source("src/components/research-group-controls.tsx");

test("all membership entry points call one canonical service", () => {
  assert.match(
    repositorySource,
    /export async function setPlaylistMembership\(/,
  );
  assert.doesNotMatch(
    repositorySource,
    /function (?:setReadLaterState|setPaperPlaylistMembership|addToPlaylist|removeFromPlaylist)\(/,
  );
  assert.doesNotMatch(
    legacyRepositorySource,
    /function (?:addToOwnedPlaylist|removeFromOwnedPlaylist)\(/,
  );

  assert.match(
    deckRouteSource,
    /setPlaylistMembership\([\s\S]*\{ kind: "read_later" \}[\s\S]*"feed"/,
  );
  assert.match(
    actionsSource,
    /setPlaylistMembership\([\s\S]*kind: "playlist"[\s\S]*input\.context/,
  );
  assert.match(
    actionsSource,
    /setPlaylistMembership\([\s\S]*kind: "new_playlist"[\s\S]*input\.context/,
  );
  assert.match(
    actionsSource,
    /removeFromPlaylistAction[\s\S]*setPlaylistMembership\([\s\S]*false,[\s\S]*"library"/,
  );
  assert.match(pickerSource, /setPaperPlaylistMembershipAction\(/);
  assert.match(feedSource, /<PlaylistPicker[\s\S]*context="feed"/);
  assert.match(digestSource, /<PlaylistPicker[\s\S]*context="digest"/);
  assert.match(detailSource, /<PlaylistPicker[\s\S]*context="paper_detail"/);
  assert.match(groupSource, /<PlaylistPicker context="group"/);
});

test("canonical membership mutation owns ordering and side effects", () => {
  const mutationSource = repositorySource.slice(
    repositorySource.indexOf("export async function setPlaylistMembership"),
    repositorySource.indexOf("export async function createPlaylist("),
  );

  assert.equal(mutationSource.match(/db\.transaction\(/g)?.length, 1);
  assert.match(mutationSource, /\.for\("update"\)/);
  assert.match(
    mutationSource,
    /orderBy\(desc\(playlistItems\.position\)\)/,
  );
  assert.match(mutationSource, /position: \(maxRows\[0\]\?\.position \?\? -1\) \+ 1/);
  assert.match(mutationSource, /\.onConflictDoNothing\(/);
  assert.match(mutationSource, /action: "save_to_playlist"/);
  assert.doesNotMatch(mutationSource, /if \(context|context ===/);
  assert.match(
    mutationSource,
    /if \(result\.changed\) scheduleProfileEmbeddingRefresh\(ownerId\)/,
  );
});

test("the existing ordering index supports the max-position lookup", () => {
  assert.match(
    schemaSource,
    /index\("playlist_items_order_idx"\)[\s\S]*table\.playlistId[\s\S]*table\.position/,
  );
});
