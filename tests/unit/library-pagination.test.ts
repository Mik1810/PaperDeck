import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { isLibraryCollectionKey } from "../../src/lib/library-collections";
import {
  decodeLibraryCursor,
  encodeLibraryCursor,
  InvalidLibraryCursorError,
} from "../../src/lib/repositories/library-cursor";

const paperId = "00000000-0000-4000-8000-000000000174";

describe("Library collection keys", () => {
  test("accepts system collections and UUID-backed playlists", () => {
    assert.equal(isLibraryCollectionKey("read-later"), true);
    assert.equal(isLibraryCollectionKey("favorites"), true);
    assert.equal(isLibraryCollectionKey("ignored"), true);
    assert.equal(isLibraryCollectionKey(`playlist:${paperId}`), true);
  });

  test("rejects malformed and unscoped collection values", () => {
    assert.equal(isLibraryCollectionKey("playlist:not-a-uuid"), false);
    assert.equal(isLibraryCollectionKey("all-playlists"), false);
    assert.equal(isLibraryCollectionKey(""), false);
  });
});

describe("Library pagination cursors", () => {
  test("round-trips a playlist keyset boundary", () => {
    const cursor = {
      paperId,
      position: 24,
      sort: "playlist" as const,
      timestamp: "2026-08-12T10:00:00.000Z",
      version: 1 as const,
    };

    assert.deepEqual(
      decodeLibraryCursor(encodeLibraryCursor(cursor), "playlist"),
      cursor,
    );
  });

  test("binds a cursor to its collection ordering", () => {
    const encoded = encodeLibraryCursor({
      paperId,
      sort: "favorites",
      timestamp: "2026-08-12T10:00:00.000Z",
      version: 1,
    });

    assert.throws(
      () => decodeLibraryCursor(encoded, "ignored"),
      InvalidLibraryCursorError,
    );
  });

  test("rejects malformed and invalid boundaries", () => {
    assert.throws(
      () => decodeLibraryCursor("not_json", "favorites"),
      InvalidLibraryCursorError,
    );
    assert.throws(
      () =>
        decodeLibraryCursor(
          Buffer.from(
            JSON.stringify({
              paperId,
              position: -1,
              sort: "playlist",
              timestamp: "not-a-date",
              version: 1,
            }),
          ).toString("base64url"),
          "playlist",
        ),
      InvalidLibraryCursorError,
    );
  });
});
