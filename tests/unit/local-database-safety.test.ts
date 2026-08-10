import assert from "node:assert/strict";
import { test } from "node:test";
import { assertDisposableLocalDatabase } from "../../scripts/local-database";

test("accepts only the disposable local PaperDeck database", () => {
  assert.doesNotThrow(() =>
    assertDisposableLocalDatabase(
      "postgresql://paperdeck:local@127.0.0.1:55432/paperdeck_test",
    ),
  );
  assert.doesNotThrow(() =>
    assertDisposableLocalDatabase(
      "postgresql://paperdeck:local@localhost:55432/paperdeck_test",
    ),
  );
  assert.doesNotThrow(() =>
    assertDisposableLocalDatabase(
      "postgresql://paperdeck:local@localhost:55432/paperdeck_local",
      "paperdeck_local",
    ),
  );
});

test("rejects remote hosts and non-disposable database names", () => {
  assert.throws(
    () =>
      assertDisposableLocalDatabase(
        "postgresql://user:secret@db.example.com:5432/paperdeck_test",
      ),
    /non-local host/,
  );
  assert.throws(
    () =>
      assertDisposableLocalDatabase(
        "postgresql://paperdeck:local@127.0.0.1:55432/postgres",
      ),
    /database is named paperdeck_test/,
  );
});
