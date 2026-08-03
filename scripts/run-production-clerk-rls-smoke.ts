import assert from "node:assert/strict";
import { createClerkClient } from "@clerk/backend";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { loadEnvConfig } from "@next/env";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  maskIdentifier,
  maskSupabaseTarget,
} from "../tests/integration/clerk-supabase-live-support";

loadEnvConfig(process.cwd());

const productionOrigin =
  process.env.PAPERDECK_PRODUCTION_ORIGIN ??
  "https://paperdeck.michaelpiccirilli.it";
const productionSecretKey = process.env.PAPERDECK_PRODUCTION_CLERK_SECRET_KEY;
const productionPublishableKey =
  process.env.PAPERDECK_PRODUCTION_CLERK_PUBLISHABLE_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const userMaskA = process.env.PAPERDECK_RLS_PRODUCTION_USER_A_MASK;
const userMaskB = process.env.PAPERDECK_RLS_PRODUCTION_USER_B_MASK;
let currentPhase = "configuration";
const failureReport = {
  temporary_sessions_detected: 0,
  temporary_sessions_revoked: 0,
};

type SessionClaims = {
  exp?: number;
  role?: string;
  sub?: string;
};

type BrowserIdentity = {
  context: BrowserContext;
  ownerId: string;
  sessionId: string;
  token: string;
};

function requireLocalConfiguration() {
  assert.ok(
    productionSecretKey?.startsWith("sk_live_"),
    "PAPERDECK_PRODUCTION_CLERK_SECRET_KEY must be a Production key",
  );
  assert.ok(
    productionPublishableKey?.startsWith("pk_live_"),
    "PAPERDECK_PRODUCTION_CLERK_PUBLISHABLE_KEY must be a Production key",
  );
  assert.ok(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required");
  assert.ok(
    supabasePublishableKey,
    "NEXT_PUBLIC_SUPABASE_ANON_KEY is required",
  );
  assert.ok(
    userMaskA?.startsWith("user_") && userMaskA.includes("..."),
    "PAPERDECK_RLS_PRODUCTION_USER_A_MASK is required",
  );
  assert.ok(
    userMaskB?.startsWith("user_") && userMaskB.includes("..."),
    "PAPERDECK_RLS_PRODUCTION_USER_B_MASK is required",
  );
  assert.notEqual(userMaskA, userMaskB, "Production user masks must differ");
  assert.equal(
    new URL(productionOrigin).protocol,
    "https:",
    "PAPERDECK_PRODUCTION_ORIGIN must use HTTPS",
  );
}

function decodeClaims(token: string): SessionClaims {
  const payload = token.split(".")[1];
  assert.ok(payload, "Invalid Clerk JWT: missing payload");
  return JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as SessionClaims;
}

function requireFreshIdentity(token: string) {
  const claims = decodeClaims(token);
  assert.ok(claims.sub, "Clerk JWT has no sub claim");
  assert.equal(
    claims.role,
    "authenticated",
    "Clerk JWT needs role=authenticated; verify the Supabase integration",
  );
  assert.ok(
    claims.exp && claims.exp > Math.floor(Date.now() / 1000) + 10,
    "Clerk JWT is expired or too close to expiry",
  );
  return claims.sub;
}

function authenticatedClient(token: string) {
  assert.ok(supabaseUrl);
  assert.ok(supabasePublishableKey);
  return createClient(supabaseUrl, supabasePublishableKey, {
    accessToken: async () => token,
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function signInTracked(
  page: Page,
  emailAddress: string,
): Promise<Omit<BrowserIdentity, "context">> {
  await page.goto(`${productionOrigin}/sign-in`, {
    waitUntil: "domcontentloaded",
  });
  try {
    await clerk.signIn({ page, emailAddress });
    await clerk.loaded({ page });
  } catch {
    throw new Error("A selected Production identity could not sign in");
  }

  const session = await page.evaluate(async () => {
    const activeSession = window.Clerk.session;
    return {
      id: activeSession?.id ?? null,
      token: (await activeSession?.getToken()) ?? null,
    };
  });
  assert.ok(session.id, "Production browser sign-in created no active session");
  assert.ok(session.token, "Production browser session returned no JWT");

  return {
    ownerId: requireFreshIdentity(session.token),
    sessionId: session.id,
    token: session.token,
  };
}

async function main() {
  requireLocalConfiguration();
  assert.ok(productionSecretKey);
  assert.ok(productionPublishableKey);
  assert.ok(supabaseUrl);
  assert.ok(userMaskA);
  assert.ok(userMaskB);

  currentPhase = "identity-resolution";
  const backend = createClerkClient({ secretKey: productionSecretKey });
  const { data: users } = await backend.users.getUserList({
    limit: 100,
    orderBy: "+created_at",
  });
  const selectedUsers = [userMaskA, userMaskB].map((targetMask) => {
    const matches = users.filter(
      (user) => maskIdentifier(user.id) === targetMask,
    );
    assert.equal(
      matches.length,
      1,
      `Expected exactly one Production user for ${targetMask}`,
    );
    return matches[0];
  });
  assert.notEqual(selectedUsers[0].id, selectedUsers[1].id);

  const selectedEmails = selectedUsers.map((user) => {
    const primaryEmail =
      user.emailAddresses.find(({ id }) => id === user.primaryEmailAddressId) ??
      user.emailAddresses[0];
    assert.ok(primaryEmail, "A selected Production identity has no email");
    assert.ok(
      !primaryEmail.emailAddress.includes("+clerk_test"),
      "Production test-mode identities are not allowed",
    );
    return primaryEmail.emailAddress;
  });

  currentPhase = "session-baseline";
  const baselineSessionIds = new Set<string>();
  for (const user of selectedUsers) {
    const activeSessions = await backend.sessions.getSessionList({
      userId: user.id,
      status: "active",
      limit: 100,
    });
    for (const session of activeSessions.data) {
      baselineSessionIds.add(session.id);
    }
  }

  process.env.CLERK_SECRET_KEY = productionSecretKey;
  delete process.env.CLERK_TESTING_TOKEN;
  delete process.env.CLERK_FAPI;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const identities: BrowserIdentity[] = [];
  const trackedSessionIds = new Set<string>();
  const revokedSessionIds = new Set<string>();
  let runError: unknown;
  let failedPhase: string | undefined;

  try {
    currentPhase = "clerk-testing-token";
    await clerkSetup({
      dotenv: false,
      publishableKey: productionPublishableKey,
      secretKey: productionSecretKey,
    });
    currentPhase = "browser-launch";
    browser = await chromium.launch({ headless: true });

    for (const [index, emailAddress] of selectedEmails.entries()) {
      currentPhase = `browser-sign-in-${index + 1}`;
      const context = await browser.newContext();
      const identity = await signInTracked(
        await context.newPage(),
        emailAddress,
      );
      trackedSessionIds.add(identity.sessionId);
      identities.push({ context, ...identity });
    }

    assert.equal(identities.length, 2);
    currentPhase = "jwt-validation";
    const [identityA, identityB] = identities;
    assert.notEqual(identityA.ownerId, identityB.ownerId);

    currentPhase = "rls-profile-read";
    const clientA = authenticatedClient(identityA.token);
    const clientB = authenticatedClient(identityB.token);
    const [viewA, viewB] = await Promise.all([
      clientA
        .from("profiles")
        .select("owner_id")
        .in("owner_id", [identityA.ownerId, identityB.ownerId]),
      clientB
        .from("profiles")
        .select("owner_id, display_name")
        .in("owner_id", [identityA.ownerId, identityB.ownerId]),
    ]);

    assert.ifError(viewA.error);
    assert.ifError(viewB.error);
    assert.deepEqual(viewA.data, [{ owner_id: identityA.ownerId }]);
    assert.deepEqual(
      viewB.data?.map(({ owner_id }) => ({ owner_id })),
      [{ owner_id: identityB.ownerId }],
      "User B needs a profile before the Production smoke can pass",
    );

    currentPhase = "rls-cross-update";
    const displayNameB = viewB.data?.[0]?.display_name ?? null;
    const crossUpdate = await clientA
      .from("profiles")
      .update({ display_name: displayNameB })
      .eq("owner_id", identityB.ownerId)
      .select("owner_id");

    assert.ifError(crossUpdate.error);
    assert.deepEqual(crossUpdate.data, []);
  } catch (error) {
    runError = error;
    failedPhase = currentPhase;
  } finally {
    currentPhase = "session-cleanup-audit";
    for (const user of selectedUsers) {
      try {
        const activeSessions = await backend.sessions.getSessionList({
          userId: user.id,
          status: "active",
          limit: 100,
        });
        for (const session of activeSessions.data) {
          if (!baselineSessionIds.has(session.id)) {
            trackedSessionIds.add(session.id);
          }
        }
      } catch {
        runError ??= new Error("Could not audit temporary Clerk sessions");
      }
    }

    failureReport.temporary_sessions_detected = trackedSessionIds.size;
    currentPhase = "session-revocation";
    const cleanupResults = await Promise.allSettled(
      [...trackedSessionIds].map(async (sessionId) => {
        await backend.sessions.revokeSession(sessionId);
        revokedSessionIds.add(sessionId);
      }),
    );
    const cleanupFailures = cleanupResults.filter(
      (result) => result.status === "rejected",
    );
    if (cleanupFailures.length > 0) {
      runError = new Error(
        `Failed ${cleanupFailures.length} Production session cleanup task(s)`,
      );
      failedPhase = currentPhase;
    }
    failureReport.temporary_sessions_revoked = revokedSessionIds.size;
    currentPhase = "browser-cleanup";
    try {
      await browser?.close();
    } catch {
      runError ??= new Error("Failed to close the Production smoke browser");
      failedPhase ??= currentPhase;
    }
  }

  currentPhase = failedPhase ?? "assertions-complete";
  assert.ifError(runError);
  assert.equal(identities.length, 2);
  assert.equal(trackedSessionIds.size, 2);
  assert.equal(revokedSessionIds.size, trackedSessionIds.size);

  console.log(
    JSON.stringify({
      event: "paperdeck_clerk_rls_smoke",
      status: "passed",
      environment: "production",
      scope: "profile-isolation",
      actors: identities.map(({ ownerId }) => maskIdentifier(ownerId)),
      supabase_target: maskSupabaseTarget(supabaseUrl),
      temporary_sessions_created: trackedSessionIds.size,
      temporary_sessions_revoked: revokedSessionIds.size,
      temporary_database_mutation: false,
      persistent_database_mutation: false,
      completed_at: new Date().toISOString(),
    }),
  );
}

main().catch(() => {
  console.error(JSON.stringify({
    event: "paperdeck_clerk_rls_smoke",
    status: "failed",
    environment: "production",
    phase: currentPhase,
    ...failureReport,
    sensitive_values_logged: false,
  }));
  process.exitCode = 1;
});
