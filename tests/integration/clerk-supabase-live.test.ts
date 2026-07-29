import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClerkClient } from "@clerk/backend";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";

loadEnvConfig(process.cwd());

const clerkSecretKey = process.env.CLERK_SECRET_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const databaseUrl = process.env.DATABASE_URL;
const emailA = process.env.PAPERDECK_RLS_USER_A_EMAIL;
const emailB = process.env.PAPERDECK_RLS_USER_B_EMAIL;
const run =
  clerkSecretKey && supabaseUrl && supabaseAnonKey && databaseUrl
    ? test
    : test.skip;

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
  let sql: Sql | undefined;
  let groupId: string | undefined;
  let originalSettings:
    | { reads_enabled: boolean; writes_enabled: boolean }
    | undefined;

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

    assert.ok(databaseUrl);
    sql = postgres(databaseUrl, { max: 1 });
    const settings = await sql<{
      reads_enabled: boolean;
      writes_enabled: boolean;
    }[]>`
      select reads_enabled, writes_enabled
      from private.research_group_runtime_settings
      where singleton
    `;
    assert.equal(settings.length, 1, "Research-group runtime settings are missing");
    originalSettings = settings[0];
    assert.equal(
      originalSettings.reads_enabled,
      false,
      "Refusing to run while research-group reads are already enabled",
    );
    assert.equal(
      originalSettings.writes_enabled,
      false,
      "Refusing to run while research-group writes are already enabled",
    );
    await sql`
      update private.research_group_runtime_settings
      set reads_enabled = true, writes_enabled = true, updated_at = now()
      where singleton
    `;

    groupId = await sql.begin(async (transaction) => {
      const [group] = await transaction<{ id: string }[]>`
        insert into research_groups (name)
        values (${`Clerk RLS ${randomUUID()}`})
        returning id
      `;
      await transaction`
        insert into research_group_members (group_id, member_id, role)
        values (${group.id}::uuid, ${ownerA}, 'owner')
      `;
      return group.id;
    });

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

    const [groupForOwner, groupForOutsider] = await Promise.all([
      clientA
        .from("research_groups")
        .select("id")
        .eq("id", groupId),
      clientB
        .from("research_groups")
        .select("id")
        .eq("id", groupId),
    ]);
    assert.ifError(groupForOwner.error);
    assert.ifError(groupForOutsider.error);
    assert.deepEqual(groupForOwner.data, [{ id: groupId }]);
    assert.deepEqual(groupForOutsider.data, []);

    await sql`
      insert into research_group_members (group_id, member_id, role)
      values (${groupId}::uuid, ${ownerB}, 'member')
    `;

    const [groupForMember, ownerMembership, memberMembership] =
      await Promise.all([
        clientB
          .from("research_groups")
          .select("id")
          .eq("id", groupId),
        clientA
          .from("research_group_members")
          .select("member_id, role")
          .eq("group_id", groupId),
        clientB
          .from("research_group_members")
          .select("member_id, role")
          .eq("group_id", groupId),
      ]);
    assert.ifError(groupForMember.error);
    assert.ifError(ownerMembership.error);
    assert.ifError(memberMembership.error);
    assert.deepEqual(groupForMember.data, [{ id: groupId }]);
    assert.deepEqual(ownerMembership.data, [
      { member_id: ownerA, role: "owner" },
    ]);
    assert.deepEqual(memberMembership.data, [
      { member_id: ownerB, role: "member" },
    ]);

    const [directGroupWrite, directMembershipWrite] = await Promise.all([
      clientA
        .from("research_groups")
        .update({ name: "Forbidden direct write" })
        .eq("id", groupId),
      clientB.from("research_group_members").insert({
        group_id: groupId,
        member_id: ownerB,
        role: "admin",
      }),
    ]);
    assert.equal(directGroupWrite.error?.code, "42501");
    assert.equal(directMembershipWrite.error?.code, "42501");

    await sql`
      update research_group_members
      set revoked_at = now(), updated_at = now()
      where group_id = ${groupId}::uuid and member_id = ${ownerB}
    `;

    const [groupAfterRevocation, membershipAfterRevocation] =
      await Promise.all([
        clientB
          .from("research_groups")
          .select("id")
          .eq("id", groupId),
        clientB
          .from("research_group_members")
          .select("member_id")
          .eq("group_id", groupId),
      ]);
    assert.ifError(groupAfterRevocation.error);
    assert.ifError(membershipAfterRevocation.error);
    assert.deepEqual(groupAfterRevocation.data, []);
    assert.deepEqual(membershipAfterRevocation.data, []);
  } finally {
    const cleanupTasks: Promise<unknown>[] = sessions.map((sessionId) =>
      clerk.sessions.revokeSession(sessionId),
    );
    cleanupTasks.push(
      (async () => {
        if (!sql) return;

        try {
          if (groupId) {
            await sql`
              delete from research_groups
              where id = ${groupId}::uuid
            `;
          }
          if (originalSettings) {
            await sql`
              update private.research_group_runtime_settings
              set
                reads_enabled = ${originalSettings.reads_enabled},
                writes_enabled = ${originalSettings.writes_enabled},
                updated_at = now()
              where singleton
            `;
          }
        } finally {
          await sql.end();
        }
      })(),
    );

    const cleanupResults = await Promise.allSettled(cleanupTasks);
    const failures = cleanupResults.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    assert.equal(
      failures.length,
      0,
      `Failed ${failures.length} Clerk session or database cleanup task(s)`,
    );
  }
});
