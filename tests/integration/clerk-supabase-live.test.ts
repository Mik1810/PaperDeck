import assert from "node:assert/strict";
import test from "node:test";
import { createClerkClient } from "@clerk/backend";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

const clerkSecretKey = process.env.CLERK_SECRET_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const emailA = process.env.PAPERDECK_RLS_USER_A_EMAIL;
const emailB = process.env.PAPERDECK_RLS_USER_B_EMAIL;
const run = clerkSecretKey && supabaseUrl && supabaseAnonKey ? test : test.skip;

type SessionClaims = {
  exp?: number;
  role?: string;
  sub?: string;
};

function decodeClaims(token: string): SessionClaims {
  const payload = token.split(".")[1];
  assert.ok(payload, "Invalid Clerk JWT: missing payload");

  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionClaims;
}

function requireFreshIdentity(token: string, label: string) {
  const claims = decodeClaims(token);
  assert.ok(claims.sub, `${label} JWT has no sub claim`);
  assert.equal(
    claims.role,
    "authenticated",
    `${label} JWT needs role=authenticated; enable Clerk's Supabase integration`,
  );
  assert.ok(
    claims.exp && claims.exp > Math.floor(Date.now() / 1000) + 10,
    `${label} JWT is expired or too close to expiry`,
  );
  return claims.sub;
}

function authenticatedClient(token: string) {
  assert.ok(supabaseUrl);
  assert.ok(supabaseAnonKey);

  return createClient(supabaseUrl, supabaseAnonKey, {
    accessToken: async () => token,
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

run("two real Clerk sessions are isolated by Supabase RLS", async () => {
  assert.ok(clerkSecretKey);
  assert.ok(
    emailA,
    "PAPERDECK_RLS_USER_A_EMAIL is required in .env.local",
  );
  assert.ok(
    emailB,
    "PAPERDECK_RLS_USER_B_EMAIL is required in .env.local",
  );
  assert.notEqual(emailA, emailB, "The two test emails must be different");
  const clerk = createClerkClient({ secretKey: clerkSecretKey });
  const sessions: string[] = [];

  try {
    const { data: users } = await clerk.users.getUserList({
      emailAddress: [emailA, emailB],
      limit: 10,
    });
    const userA = users.find((user) =>
      user.emailAddresses.some(({ emailAddress }) => emailAddress === emailA),
    );
    const userB = users.find((user) =>
      user.emailAddresses.some(({ emailAddress }) => emailAddress === emailB),
    );

    assert.ok(userA, "Clerk test user A was not found");
    assert.ok(userB, "Clerk test user B was not found");

    const sessionA = await clerk.sessions.createSession({ userId: userA.id });
    sessions.push(sessionA.id);
    const sessionB = await clerk.sessions.createSession({ userId: userB.id });
    sessions.push(sessionB.id);

    const [tokenA, tokenB] = await Promise.all([
      clerk.sessions.getToken(sessionA.id),
      clerk.sessions.getToken(sessionB.id),
    ]);
    const ownerA = requireFreshIdentity(tokenA.jwt, "User A");
    const ownerB = requireFreshIdentity(tokenB.jwt, "User B");
    assert.notEqual(ownerA, ownerB, "The two Clerk users must be different");

    const clientA = authenticatedClient(tokenA.jwt);
    const clientB = authenticatedClient(tokenB.jwt);
    const [viewA, viewB] = await Promise.all([
      clientA.from("profiles").select("owner_id").in("owner_id", [ownerA, ownerB]),
      clientB
        .from("profiles")
        .select("owner_id, display_name")
        .in("owner_id", [ownerA, ownerB]),
    ]);

    assert.ifError(viewA.error);
    assert.ifError(viewB.error);
    assert.deepEqual(viewA.data, [{ owner_id: ownerA }]);
    assert.deepEqual(
      viewB.data?.map(({ owner_id }) => ({ owner_id })),
      [{ owner_id: ownerB }],
      "User B needs a profile; complete onboarding before retrying",
    );

    const displayNameB = viewB.data?.[0]?.display_name ?? null;
    const crossUpdate = await clientA
      .from("profiles")
      .update({ display_name: displayNameB })
      .eq("owner_id", ownerB)
      .select("owner_id");

    assert.ifError(crossUpdate.error);
    assert.deepEqual(crossUpdate.data, []);
  } finally {
    const revocations = await Promise.allSettled(
      sessions.map((sessionId) => clerk.sessions.revokeSession(sessionId)),
    );
    const failures = revocations.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    assert.equal(
      failures.length,
      0,
      `Failed to revoke ${failures.length} temporary Clerk session(s)`,
    );
  }
});
