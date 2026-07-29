import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertResearchGroupPermission,
  hasResearchGroupRole,
  ResearchGroupUnavailableError,
} from "@/lib/research-groups/permissions";

describe("research-group role hierarchy", () => {
  it("allows roles at or above the requested level", () => {
    assert.equal(hasResearchGroupRole("owner", "owner"), true);
    assert.equal(hasResearchGroupRole("owner", "admin"), true);
    assert.equal(hasResearchGroupRole("owner", "member"), true);
    assert.equal(hasResearchGroupRole("admin", "admin"), true);
    assert.equal(hasResearchGroupRole("admin", "member"), true);
    assert.equal(hasResearchGroupRole("member", "member"), true);
  });

  it("rejects insufficient and absent roles", () => {
    assert.equal(hasResearchGroupRole("admin", "owner"), false);
    assert.equal(hasResearchGroupRole("member", "admin"), false);
    assert.equal(hasResearchGroupRole(null, "member"), false);
  });
});

describe("research-group feature gates", () => {
  it("allows reads when the read switch and role both permit them", () => {
    assert.doesNotThrow(() =>
      assertResearchGroupPermission({
        actualRole: "member",
        minimumRole: "member",
        operation: "read",
        readsEnabled: true,
        writesEnabled: false,
      }),
    );
  });

  it("requires both switches for writes", () => {
    assert.throws(
      () =>
        assertResearchGroupPermission({
          actualRole: "owner",
          minimumRole: "owner",
          operation: "write",
          readsEnabled: true,
          writesEnabled: false,
        }),
      ResearchGroupUnavailableError,
    );
    assert.doesNotThrow(() =>
      assertResearchGroupPermission({
        actualRole: "owner",
        minimumRole: "owner",
        operation: "write",
        readsEnabled: true,
        writesEnabled: true,
      }),
    );
  });

  it("uses the same unavailable error for disabled and unauthorized access", () => {
    const capture = (callback: () => void) => {
      try {
        callback();
        assert.fail("Expected access to be denied");
      } catch (error) {
        assert.ok(error instanceof ResearchGroupUnavailableError);
        return { name: error.name, message: error.message };
      }
    };

    const disabled = capture(() =>
      assertResearchGroupPermission({
        actualRole: "owner",
        minimumRole: "member",
        operation: "read",
        readsEnabled: false,
        writesEnabled: false,
      }),
    );
    const outsider = capture(() =>
      assertResearchGroupPermission({
        actualRole: null,
        minimumRole: "member",
        operation: "read",
        readsEnabled: true,
        writesEnabled: true,
      }),
    );
    const insufficient = capture(() =>
      assertResearchGroupPermission({
        actualRole: "member",
        minimumRole: "admin",
        operation: "write",
        readsEnabled: true,
        writesEnabled: true,
      }),
    );

    assert.deepEqual(disabled, outsider);
    assert.deepEqual(outsider, insufficient);
  });
});
