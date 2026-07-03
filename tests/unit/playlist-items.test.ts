import assert from "node:assert/strict";
import test from "node:test";
import {
  addToOwnedPlaylist,
  removeFromOwnedPlaylist,
  reorderOwnedPlaylistItems,
  type PlaylistItemMutationClient,
} from "../../src/lib/repositories/playlist-items";

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
};

type QueryCall = {
  table: string;
  method: string;
  args: unknown[];
};

class FakeSupabase {
  calls: QueryCall[] = [];

  constructor(private readonly results: QueryResult[]) {}

  from(table: string) {
    return new FakeQuery(this, table);
  }

  nextResult() {
    return this.results.shift() ?? { data: null, error: null };
  }

  record(table: string, method: string, args: unknown[]) {
    this.calls.push({ table, method, args });
  }
}

class FakeQuery implements PromiseLike<QueryResult> {
  constructor(
    private readonly supabase: FakeSupabase,
    private readonly table: string,
  ) {}

  select(columns: string) {
    this.supabase.record(this.table, "select", [columns]);
    return this;
  }

  eq(column: string, value: string) {
    this.supabase.record(this.table, "eq", [column, value]);
    return this;
  }

  order(column: string, options: { ascending: boolean }) {
    this.supabase.record(this.table, "order", [column, options]);
    return this;
  }

  limit(count: number) {
    this.supabase.record(this.table, "limit", [count]);
    return this;
  }

  maybeSingle() {
    this.supabase.record(this.table, "maybeSingle", []);
    return Promise.resolve(this.supabase.nextResult());
  }

  upsert(row: unknown, options: unknown) {
    this.supabase.record(this.table, "upsert", [row, options]);
    return this;
  }

  delete() {
    this.supabase.record(this.table, "delete", []);
    return this;
  }

  update(row: unknown) {
    this.supabase.record(this.table, "update", [row]);
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.supabase.nextResult()).then(
      onfulfilled,
      onrejected,
    );
  }
}

function asPlaylistClient(supabase: FakeSupabase) {
  return supabase as unknown as PlaylistItemMutationClient;
}

function hasCall(
  calls: QueryCall[],
  table: string,
  method: string,
  args: unknown[],
) {
  return calls.some(
    (call) =>
      call.table === table &&
      call.method === method &&
      JSON.stringify(call.args) === JSON.stringify(args),
  );
}

test("addToOwnedPlaylist rejects a playlist owned by another user", async () => {
  const supabase = new FakeSupabase([{ data: null, error: null }]);

  await assert.rejects(
    () =>
      addToOwnedPlaylist(
        asPlaylistClient(supabase),
        "owner-a",
        "playlist-b",
        "paper-1",
      ),
    /not found or not owned by user/,
  );

  assert.equal(
    hasCall(supabase.calls, "playlists", "eq", ["owner_id", "owner-a"]),
    true,
  );
  assert.equal(
    supabase.calls.some((call) => call.table === "playlist_items"),
    false,
  );
});

test("addToOwnedPlaylist appends after verifying playlist ownership", async () => {
  const supabase = new FakeSupabase([
    { data: { id: "playlist-a" }, error: null },
    { data: { position: 2 }, error: null },
    { data: null, error: null },
  ]);

  await addToOwnedPlaylist(
    asPlaylistClient(supabase),
    "owner-a",
    "playlist-a",
    "paper-1",
  );

  assert.equal(
    hasCall(supabase.calls, "playlists", "eq", ["id", "playlist-a"]),
    true,
  );
  assert.equal(
    hasCall(supabase.calls, "playlists", "eq", ["owner_id", "owner-a"]),
    true,
  );
  assert.equal(
    hasCall(supabase.calls, "playlist_items", "eq", [
      "playlist_id",
      "playlist-a",
    ]),
    true,
  );
  assert.equal(
    hasCall(supabase.calls, "playlist_items", "upsert", [
      { playlist_id: "playlist-a", paper_id: "paper-1", position: 3 },
      { onConflict: "playlist_id,paper_id" },
    ]),
    true,
  );
});

test("removeFromOwnedPlaylist rejects a playlist owned by another user", async () => {
  const supabase = new FakeSupabase([{ data: null, error: null }]);

  await assert.rejects(
    () =>
      removeFromOwnedPlaylist(
        asPlaylistClient(supabase),
        "owner-a",
        "playlist-b",
        "paper-1",
      ),
    /not found or not owned by user/,
  );

  assert.equal(
    hasCall(supabase.calls, "playlists", "eq", ["owner_id", "owner-a"]),
    true,
  );
  assert.equal(
    supabase.calls.some((call) => call.table === "playlist_items"),
    false,
  );
});

test("removeFromOwnedPlaylist deletes after verifying playlist ownership", async () => {
  const supabase = new FakeSupabase([
    { data: { id: "playlist-a" }, error: null },
    { data: null, error: null },
  ]);

  await removeFromOwnedPlaylist(
    asPlaylistClient(supabase),
    "owner-a",
    "playlist-a",
    "paper-1",
  );

  assert.equal(
    hasCall(supabase.calls, "playlists", "eq", ["id", "playlist-a"]),
    true,
  );
  assert.equal(
    hasCall(supabase.calls, "playlists", "eq", ["owner_id", "owner-a"]),
    true,
  );
  assert.equal(
    hasCall(supabase.calls, "playlist_items", "delete", []),
    true,
  );
  assert.equal(
    hasCall(supabase.calls, "playlist_items", "eq", [
      "playlist_id",
      "playlist-a",
    ]),
    true,
  );
  assert.equal(
    hasCall(supabase.calls, "playlist_items", "eq", ["paper_id", "paper-1"]),
    true,
  );
});

test("reorderOwnedPlaylistItems rejects a playlist owned by another user", async () => {
  const supabase = new FakeSupabase([{ data: null, error: null }]);

  await assert.rejects(
    () =>
      reorderOwnedPlaylistItems(
        asPlaylistClient(supabase),
        "owner-a",
        "playlist-b",
        ["paper-1", "paper-2"],
      ),
    /not found or not owned by user/,
  );

  assert.equal(
    hasCall(supabase.calls, "playlists", "eq", ["owner_id", "owner-a"]),
    true,
  );
  assert.equal(
    supabase.calls.some((call) => call.table === "playlist_items"),
    false,
  );
});

test("reorderOwnedPlaylistItems updates positions after verifying playlist ownership", async () => {
  const supabase = new FakeSupabase([
    { data: { id: "playlist-a" }, error: null },
    { data: null, error: null },
    { data: null, error: null },
  ]);

  await reorderOwnedPlaylistItems(
    asPlaylistClient(supabase),
    "owner-a",
    "playlist-a",
    ["paper-1", "paper-2"],
  );

  const updates = supabase.calls
    .filter(
      (call) => call.table === "playlist_items" && call.method === "update",
    )
    .map((call) => call.args[0]);

  assert.equal(
    hasCall(supabase.calls, "playlists", "eq", ["id", "playlist-a"]),
    true,
  );
  assert.equal(
    hasCall(supabase.calls, "playlists", "eq", ["owner_id", "owner-a"]),
    true,
  );
  assert.deepEqual(updates, [{ position: 0 }, { position: 1 }]);
  assert.equal(
    hasCall(supabase.calls, "playlist_items", "eq", [
      "playlist_id",
      "playlist-a",
    ]),
    true,
  );
  assert.equal(
    hasCall(supabase.calls, "playlist_items", "eq", ["paper_id", "paper-1"]),
    true,
  );
  assert.equal(
    hasCall(supabase.calls, "playlist_items", "eq", ["paper_id", "paper-2"]),
    true,
  );
});
