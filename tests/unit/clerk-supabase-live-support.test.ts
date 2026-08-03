import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasInjectedRlsTargetEnvironment,
  maskIdentifier,
  maskSupabaseTarget,
  resolveClerkRlsSmokeConfig,
  shouldRunClerkRlsSmoke,
  validateClerkEnvironment,
  validateTargetEnvironmentInjection,
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
    const config = resolveClerkRlsSmokeConfig({
      PAPERDECK_RLS_TARGET_ENVIRONMENT: "development",
    });

    assert.doesNotThrow(() =>
      validateClerkEnvironment("sk_test_redacted", config.environment),
    );
  });

  it("rejects a Development Clerk key for Production", () => {
    assert.throws(
      () => validateClerkEnvironment("sk_test_redacted", "production"),
      /does not match/,
    );
  });

  it("requires Production credentials before loading local env", () => {
    assert.equal(
      hasInjectedRlsTargetEnvironment({
        CLERK_SECRET_KEY: "configured",
        NEXT_PUBLIC_SUPABASE_URL: "configured",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "configured",
      }),
      true,
    );
    assert.equal(
      hasInjectedRlsTargetEnvironment({ CLERK_SECRET_KEY: "configured" }),
      false,
    );
    assert.throws(
      () => validateTargetEnvironmentInjection(false, "production"),
      /must be injected/,
    );
    assert.doesNotThrow(() =>
      validateTargetEnvironmentInjection(false, "development"),
    );
  });

  it("never skips an explicitly declared release target", () => {
    assert.equal(shouldRunClerkRlsSmoke(true, false), true);
    assert.equal(shouldRunClerkRlsSmoke(false, false), false);
    assert.equal(shouldRunClerkRlsSmoke(false, true), true);
  });

  it("restricts the mutating group lifecycle smoke to Development", () => {
    assert.throws(
      () =>
        resolveClerkRlsSmokeConfig({
          PAPERDECK_RLS_TARGET_ENVIRONMENT: "production",
          PAPERDECK_RLS_SMOKE_SCOPE: "group-lifecycle",
        }),
      /restricted to Development/,
    );
  });

  it("requires Clerk-supported test addresses outside Production", () => {
    assert.doesNotThrow(() =>
      validateTestIdentityKind(
        ["a+clerk_test@example.test", "b+clerk_test@example.test"],
        "development",
      ),
    );
    assert.throws(
      () =>
        validateTestIdentityKind(
          ["a@example.test", "b+clerk_test@example.test"],
          "development",
        ),
      /test addresses/,
    );
  });

  it("refuses Clerk test-mode identities in Production", () => {
    assert.throws(
      () =>
        validateTestIdentityKind(
          ["a+clerk_test@example.test", "b@example.test"],
          "production",
        ),
      /must not depend on Clerk test mode/,
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
