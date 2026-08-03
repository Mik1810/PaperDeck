import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  maskIdentifier,
  maskSupabaseTarget,
  resolveClerkRlsSmokeConfig,
  shouldRunClerkRlsSmoke,
  validateClerkEnvironment,
  validateTestIdentityKind,
} from "../integration/clerk-supabase-live-support";

describe("Clerk/Supabase live smoke safeguards", () => {
  it("defaults to the non-mutating Development profile smoke", () => {
    assert.deepEqual(resolveClerkRlsSmokeConfig({}), {
      environment: "development",
      scope: "profile-isolation",
    });
  });

  it("allows Development profile isolation with a Development Clerk key", () => {
    assert.deepEqual(
      resolveClerkRlsSmokeConfig({
        PAPERDECK_RLS_TARGET_ENVIRONMENT: "development",
      }),
      { environment: "development", scope: "profile-isolation" },
    );
    assert.doesNotThrow(() => validateClerkEnvironment("sk_test_redacted"));
  });

  it("rejects Production as a live-smoke target", () => {
    assert.throws(
      () =>
        resolveClerkRlsSmokeConfig({
          PAPERDECK_RLS_TARGET_ENVIRONMENT: "production",
        }),
      /restricted to Development/,
    );
  });

  it("rejects a Production Clerk key", () => {
    assert.throws(
      () => validateClerkEnvironment("sk_live_redacted"),
      /Development sk_test_/,
    );
  });

  it("never skips an explicitly declared Development target", () => {
    assert.equal(shouldRunClerkRlsSmoke(true, false), true);
    assert.equal(shouldRunClerkRlsSmoke(false, false), false);
    assert.equal(shouldRunClerkRlsSmoke(false, true), true);
  });

  it("allows the group lifecycle smoke only under the Development target", () => {
    assert.deepEqual(
      resolveClerkRlsSmokeConfig({
        PAPERDECK_RLS_TARGET_ENVIRONMENT: "development",
        PAPERDECK_RLS_SMOKE_SCOPE: "group-lifecycle",
      }),
      { environment: "development", scope: "group-lifecycle" },
    );
  });

  it("requires Clerk-supported Development test addresses", () => {
    assert.doesNotThrow(() =>
      validateTestIdentityKind(
        ["a+clerk_test@example.test", "b+clerk_test@example.test"],
      ),
    );
    assert.throws(
      () =>
        validateTestIdentityKind(
          ["a@example.test", "b+clerk_test@example.test"],
        ),
      /\+clerk_test addresses/,
    );
  });

  it("masks actor identifiers in evidence", () => {
    assert.equal(maskIdentifier("user_1234567890abcdef"), "user_1...cdef");
    assert.equal(maskIdentifier("short"), "[redacted]");
    assert.equal(
      maskSupabaseTarget("https://abcdefghijklmnop.supabase.co"),
      "abcdef...mnop",
    );
  });
});
