import assert from "node:assert/strict";

export type ClerkRlsTargetEnvironment = "development" | "production";

export type ClerkRlsSmokeScope = "profile-isolation" | "group-lifecycle";

export type ClerkRlsSmokeConfig = {
  environment: ClerkRlsTargetEnvironment;
  scope: ClerkRlsSmokeScope;
};

const targetEnvironments = new Set<ClerkRlsTargetEnvironment>([
  "development",
  "production",
]);
const smokeScopes = new Set<ClerkRlsSmokeScope>([
  "profile-isolation",
  "group-lifecycle",
]);

export function resolveClerkRlsSmokeConfig(
  env: Readonly<Record<string, string | undefined>>,
): ClerkRlsSmokeConfig {
  const environment = env.PAPERDECK_RLS_TARGET_ENVIRONMENT ?? "development";
  const scope = env.PAPERDECK_RLS_SMOKE_SCOPE ?? "profile-isolation";

  assert.ok(
    targetEnvironments.has(environment as ClerkRlsTargetEnvironment),
    "PAPERDECK_RLS_TARGET_ENVIRONMENT must be development or production",
  );
  assert.ok(
    smokeScopes.has(scope as ClerkRlsSmokeScope),
    "PAPERDECK_RLS_SMOKE_SCOPE must be profile-isolation or group-lifecycle",
  );
  assert.ok(
    scope !== "group-lifecycle" || environment === "development",
    "The group lifecycle smoke is restricted to Development because it temporarily changes shared database state",
  );

  return {
    environment: environment as ClerkRlsTargetEnvironment,
    scope: scope as ClerkRlsSmokeScope,
  };
}

export function validateClerkEnvironment(
  secretKey: string,
  environment: ClerkRlsTargetEnvironment,
) {
  const expectedPrefix = environment === "production" ? "sk_live_" : "sk_test_";
  assert.ok(
    secretKey.startsWith(expectedPrefix),
    `Clerk key type does not match the declared ${environment} target`,
  );
}

export function hasInjectedRlsTargetEnvironment(
  env: Readonly<Record<string, string | undefined>>,
) {
  return [
    "CLERK_SECRET_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ].every((name) => Boolean(env[name]));
}

export function shouldRunClerkRlsSmoke(
  targetWasDeclared: boolean,
  credentialsAreConfigured: boolean,
) {
  return targetWasDeclared || credentialsAreConfigured;
}

export function validateTargetEnvironmentInjection(
  wasInjected: boolean,
  environment: ClerkRlsTargetEnvironment,
) {
  assert.ok(
    environment !== "production" || wasInjected,
    "Production credentials must be injected before .env.local is loaded",
  );
}

export function validateTestIdentityKind(
  emails: readonly string[],
  environment: ClerkRlsTargetEnvironment,
) {
  if (environment === "production") {
    assert.ok(
      emails.every((email) => !email.includes("+clerk_test")),
      "Production smoke identities must not depend on Clerk test mode",
    );
    return;
  }

  assert.ok(
    emails.every((email) => email.includes("+clerk_test")),
    "Development smoke identities must use Clerk-supported test addresses",
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
