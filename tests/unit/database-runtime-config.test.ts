import assert from "node:assert/strict";
import test from "node:test";
import {
  type RuntimeDatabaseEnvironment,
  validateHostedDatabaseConfiguration,
} from "@/db/runtime-config";

function hostedEnvironment(
  overrides: RuntimeDatabaseEnvironment = {},
): RuntimeDatabaseEnvironment {
  return {
    VERCEL: "1",
    VERCEL_ENV: "preview",
    DATABASE_URL:
      "postgresql://paperdeck.example:secret@aws-0-region.pooler.supabase.com:6543/postgres",
    DATABASE_MAX_CONNECTIONS: "3",
    ...overrides,
  };
}

test("accepts the shared Transaction pooler in hosted runtimes", () => {
  assert.deepEqual(
    validateHostedDatabaseConfiguration(hostedEnvironment()),
    {
      environment: "preview",
      hostKind: "supabase-shared-pooler",
      port: 6543,
      maxConnections: 3,
    },
  );
});

test("does not constrain isolated local and CI databases", () => {
  assert.equal(
    validateHostedDatabaseConfiguration({
      DATABASE_URL:
        "postgresql://paperdeck:local@127.0.0.1:55432/paperdeck_local",
      DATABASE_MAX_CONNECTIONS: "3",
    }),
    null,
  );
});

test("rejects Session mode on Vercel without exposing the URL", () => {
  assert.throws(
    () =>
      validateHostedDatabaseConfiguration(
        hostedEnvironment({
          DATABASE_URL:
            "postgresql://paperdeck.example:do-not-report@aws-0-region.pooler.supabase.com:5432/postgres",
        }),
      ),
    (error: Error) => {
      assert.match(error.message, /Transaction mode.*6543/);
      assert.doesNotMatch(error.message, /do-not-report/);
      return true;
    },
  );
});

test("rejects direct and unrelated database hosts on Vercel", () => {
  for (const databaseUrl of [
    "postgresql://paperdeck:secret@db.example.supabase.co:5432/postgres",
    "postgresql://paperdeck:secret@127.0.0.1:55432/paperdeck_local",
  ]) {
    assert.throws(
      () =>
        validateHostedDatabaseConfiguration(
          hostedEnvironment({ DATABASE_URL: databaseUrl }),
        ),
      /shared pooler/,
    );
  }
});

test("rejects a one-connection hosted application pool", () => {
  assert.throws(
    () =>
      validateHostedDatabaseConfiguration(
        hostedEnvironment({ DATABASE_MAX_CONNECTIONS: "1" }),
      ),
    /DATABASE_MAX_CONNECTIONS must be 3/,
  );
});
