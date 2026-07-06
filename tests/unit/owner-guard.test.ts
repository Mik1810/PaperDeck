import { describe, it } from "node:test";
import assert from "node:assert";
import { requireOwnerId, normalizeOwnerId } from "@/lib/repositories/owner-guard";

describe("requireOwnerId", () => {
  it("passes for valid owner ids", () => {
    assert.doesNotThrow(() => requireOwnerId("user_123", "test_op"));
    assert.doesNotThrow(() => requireOwnerId("clerk-user-id", "test_op"));
    assert.doesNotThrow(() => requireOwnerId("a", "test_op"));
  });

  it("throws for empty owner id", () => {
    assert.throws(
      () => requireOwnerId("", "test_op"),
      /Owner-scoped operation "test_op" requires a non-empty owner id/,
    );
  });

  it("throws for whitespace-only owner id", () => {
    assert.throws(
      () => requireOwnerId("   ", "deletePlaylist"),
      /Owner-scoped operation "deletePlaylist" requires a non-empty owner id/,
    );
  });

  it("throws for non-string owner id", () => {
    assert.throws(
      () => requireOwnerId(null as unknown as string, "test_op"),
    );
    assert.throws(
      () => requireOwnerId(undefined as unknown as string, "test_op"),
    );
  });
});

describe("normalizeOwnerId", () => {
  it("trims whitespace", () => {
    assert.strictEqual(normalizeOwnerId("  user_123  "), "user_123");
  });

  it("throws for empty after trim", () => {
    assert.throws(
      () => normalizeOwnerId("   "),
      /Owner id cannot be empty/,
    );
  });

  it("returns already-clean ids unchanged", () => {
    assert.strictEqual(normalizeOwnerId("user_123"), "user_123");
  });
});
