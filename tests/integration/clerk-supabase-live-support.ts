import assert from "node:assert/strict";

export type ClerkRlsTargetEnvironment = "development";

export type ClerkRlsSmokeScope = "profile-isolation" | "group-lifecycle";

export type ClerkRlsSmokeConfig = {
  environment: ClerkRlsTargetEnvironment;
  scope: ClerkRlsSmokeScope;
};

const smokeScopes = new Set<ClerkRlsSmokeScope>([
  "profile-isolation",
  "group-lifecycle",
]);

export function resolveClerkRlsSmokeConfig(
  env: Readonly<Record<string, string | undefined>>,
): ClerkRlsSmokeConfig {
  const environment = env.PAPERDECK_RLS_TARGET_ENVIRONMENT ?? "development";
  const scope = env.PAPERDECK_RLS_SMOKE_SCOPE ?? "profile-isolation";

  assert.equal(
    environment,
    "development",
    "Clerk/Supabase live smokes are restricted to Development",
  );
  assert.ok(
    smokeScopes.has(scope as ClerkRlsSmokeScope),
    "PAPERDECK_RLS_SMOKE_SCOPE must be profile-isolation or group-lifecycle",
  );
  return {
    environment: environment as ClerkRlsTargetEnvironment,
    scope: scope as ClerkRlsSmokeScope,
  };
}

export function validateClerkEnvironment(secretKey: string) {
  assert.ok(
    secretKey.startsWith("sk_test_"),
    "Clerk/Supabase live smokes require a Development sk_test_ key",
  );
}

export function shouldRunClerkRlsSmoke(
  targetWasDeclared: boolean,
  credentialsAreConfigured: boolean,
) {
  return targetWasDeclared || credentialsAreConfigured;
}

export function validateTestIdentityKind(emails: readonly string[]) {
  assert.ok(
    emails.every((email) => email.includes("+clerk_test")),
    "Clerk/Supabase live smokes require Clerk-supported +clerk_test addresses",
  );
}

export function maskIdentifier(value: string) {
  if (value.length <= 10) return "[redacted]";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function maskSupabaseTarget(url: string) {
  const projectReference = new URL(url).hostname.split(".")[0];
  assert.ok(projectReference, "Supabase URL has no project reference");
  return maskIdentifier(projectReference);
}
