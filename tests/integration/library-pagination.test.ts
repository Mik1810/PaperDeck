import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import postgres, { type Sql } from "postgres";
import type { LibraryCollectionKey } from "../../src/lib/library-collections";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.PAPERDECK_RUN_LIBRARY_INTEGRATION === "true";
const run = databaseUrl && enabled ? test : test.skip;
const ownerId = `library-pagination-${randomUUID()}`;
const otherOwnerId = `library-pagination-other-${randomUUID()}`;
const paperIds = Array.from({ length: 32 }, () => randomUUID());
let sql: Sql | undefined;
let defaultPlaylistId = "";
let customPlaylistId = "";
let otherPlaylistId = "";
let getLibraryCollectionPage: typeof import("../../src/lib/repositories/user-data")["getLibraryCollectionPage"];
let getLibraryInitialData: typeof import("../../src/lib/repositories/user-data")["getLibraryInitialData"];

async function cleanup() {
  assert.ok(sql);
  await sql`delete from profiles where owner_id in (${ownerId}, ${otherOwnerId})`;
  await sql`delete from papers where id in ${sql(paperIds)}`;
}

before(async () => {
  if (!databaseUrl || !enabled) return;
  sql = postgres(databaseUrl, { max: 4, prepare: false });
  const repository = await import("../../src/lib/repositories/user-data");
  getLibraryCollectionPage = repository.getLibraryCollectionPage;
  getLibraryInitialData = repository.getLibraryInitialData;

  await cleanup();
  await sql`
    insert into profiles (owner_id, display_name)
    values (${ownerId}, 'Library pagination fixture'),
           (${otherOwnerId}, 'Other Library fixture')
  `;

  const paperRows = paperIds.map((id, index) => ({
    abstract: `Synthetic abstract ${index}`,
    access: "open",
    id,
    source: "manual",
    title: `Library pagination paper ${index.toString().padStart(2, "0")}`,
    url: `https://example.test/library-pagination/${index}`,
    year: 2026,
  }));
  await sql`
    insert into papers ${sql(
      paperRows,
      "id",
      "title",
      "abstract",
      "year",
      "source",
      "url",
      "access",
    )}
  `;

  const [defaultPlaylist, customPlaylist, otherPlaylist] = await sql<
    { id: string }[]
  >`
    insert into playlists (owner_id, name, is_default)
    values (${ownerId}, 'Read later', true),
           (${ownerId}, 'Large custom playlist', false),
           (${otherOwnerId}, 'Private other playlist', false)
    returning id
  `;
  defaultPlaylistId = defaultPlaylist.id;
  customPlaylistId = customPlaylist.id;
  otherPlaylistId = otherPlaylist.id;

  const customItems = paperIds.slice(0, 30).map((paperId, position) => ({
    added_at: new Date(Date.UTC(2026, 7, 12, 12, 0, 0) - position * 1000),
    paper_id: paperId,
    playlist_id: customPlaylistId,
    position,
  }));
  await sql`
    insert into playlist_items ${sql(
      customItems,
      "playlist_id",
      "paper_id",
      "position",
      "added_at",
    )}
  `;
  await sql`
    insert into playlist_items (playlist_id, paper_id, position)
    values (${defaultPlaylistId}::uuid, ${paperIds[30]}::uuid, 0),
           (${otherPlaylistId}::uuid, ${paperIds[31]}::uuid, 0)
  `;

  const favoriteRows = paperIds.slice(0, 30).map((paperId, index) => ({
    created_at: new Date(Date.UTC(2026, 7, 12, 10, 0, 0) - index * 1000),
    owner_id: ownerId,
    paper_id: paperId,
  }));
  await sql`
    insert into favorites ${sql(
      favoriteRows,
      "owner_id",
      "paper_id",
      "created_at",
    )}
  `;

  await sql`
    insert into user_paper_interactions
      (owner_id, paper_id, action, created_at)
    values
      (${ownerId}, ${paperIds[0]}::uuid, 'dismiss', '2026-08-12T08:00:00Z'),
      (${ownerId}, ${paperIds[0]}::uuid, 'not_interested', '2026-08-12T09:00:00Z'),
      (${ownerId}, ${paperIds[1]}::uuid, 'dismiss', '2026-08-12T07:00:00Z')
  `;
});

after(async () => {
  if (!sql) return;
  try {
    await cleanup();
  } finally {
    await sql.end();
  }
});

run("loads metadata plus only the requested first collection page", async () => {
  const initial = await getLibraryInitialData(
    ownerId,
    `playlist:${customPlaylistId}`,
  );

  assert.equal(initial.selectedCollectionKey, `playlist:${customPlaylistId}`);
  assert.equal(initial.initialCollectionPage.items.length, 24);
  assert.ok(initial.initialCollectionPage.nextCursor);
  assert.equal(initial.readLaterCount, 1);
  assert.equal(initial.favoriteCount, 30);
  assert.equal(initial.ignoredCount, 2);
  assert.equal(
    initial.playlists.find((playlist) => playlist.id === customPlaylistId)
      ?.count,
    30,
  );
  assert.equal(
    JSON.stringify(initial).includes("Library pagination paper 31"),
    false,
    "another owner's paper must not be hydrated",
  );
});

run("uses a stable keyset cursor without duplicates", async () => {
  assert.ok(sql);
  const first = await getLibraryCollectionPage(ownerId, "favorites");
  assert.equal(first.items.length, 24);
  assert.ok(first.nextCursor);

  await sql`
    insert into favorites (owner_id, paper_id, created_at)
    values (${ownerId}, ${paperIds[30]}::uuid, '2026-08-12T11:00:00Z')
  `;

  const second = await getLibraryCollectionPage(
    ownerId,
    "favorites",
    first.nextCursor,
  );
  const combinedIds = [...first.items, ...second.items].map(
    (item) => item.paper.id,
  );

  assert.equal(second.items.length, 6);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set(combinedIds).size, 30);
  assert.equal(combinedIds.includes(paperIds[30]), false);
});

run("deduplicates ignored history and returns the latest action", async () => {
  const initial = await getLibraryInitialData(ownerId, "ignored");
  const firstPaper = initial.initialCollectionPage.items.find(
    (item) => item.paper.id === paperIds[0],
  );

  assert.equal(initial.initialCollectionPage.items.length, 2);
  assert.equal(firstPaper?.ignoredAction, "not_interested");
  assert.equal(initial.initialCollectionPage.nextCursor, null);
});

run("does not expose an unowned playlist", async () => {
  const key = `playlist:${otherPlaylistId}` as LibraryCollectionKey;
  const page = await getLibraryCollectionPage(ownerId, key);

  assert.deepEqual(page.items, []);
  assert.equal(page.nextCursor, null);
});
