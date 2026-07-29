import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { Webhook } from "standardwebhooks";
import { handleDeletedClerkUser } from "@/lib/clerk/user-deletion";
import { verifyWebhook } from "@/lib/clerk/webhook-verification";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const optedIn =
  process.env.PAPERDECK_RUN_CLERK_DELETION_LIVE === "true";
const run =
  optedIn &&
  databaseUrl &&
  supabaseUrl &&
  serviceRoleKey
    ? test
    : test.skip;

const ownerA = `clerk-delete-live-a-${randomUUID()}`;
const ownerB = `clerk-delete-live-b-${randomUUID()}`;
const ownerC = `clerk-delete-live-c-${randomUUID()}`;
const ownerD = `clerk-delete-live-d-${randomUUID()}`;
const owners = [ownerA, ownerB, ownerC, ownerD];

function lookupHash(ownerId: string) {
  return createHash("sha256").update(ownerId).digest("hex");
}

function signedDeletionRequest(ownerId: string, secret: string) {
  const body = JSON.stringify({
    data: {
      deleted: true,
      id: ownerId,
      object: "user",
    },
    object: "event",
    timestamp: Date.now(),
    type: "user.deleted",
  });
  const messageId = `msg_${randomUUID()}`;
  const timestamp = new Date();
  const signer = new Webhook(secret);

  return new Request("http://localhost/api/webhooks/clerk", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "svix-id": messageId,
      "svix-signature": signer.sign(messageId, timestamp, body),
      "svix-timestamp": Math.floor(timestamp.getTime() / 1000).toString(),
    },
  });
}

async function createGroup(
  sql: Sql,
  ownerId: string,
  members: Array<{
    id: string;
    role: "admin" | "member";
    joinedAt?: string;
  }> = [],
) {
  return sql.begin(async (transaction: TransactionSql) => {
    const [group] = await transaction<{ id: string }[]>`
      insert into research_groups (name)
      values (${`Clerk deletion live ${randomUUID()}`})
      returning id
    `;
    await transaction`
      insert into research_group_members (group_id, member_id, role)
      values (${group.id}::uuid, ${ownerId}, 'owner')
    `;
    for (const member of members) {
      await transaction`
        insert into research_group_members (
          group_id,
          member_id,
          role,
          joined_at
        )
        values (
          ${group.id}::uuid,
          ${member.id},
          ${member.role},
          ${member.joinedAt ?? new Date().toISOString()}::timestamptz
        )
      `;
    }
    return group.id;
  });
}

run("a signed synthetic user.deleted event runs the atomic Development lifecycle", async () => {
  assert.ok(databaseUrl);
  assert.ok(supabaseUrl);
  assert.ok(serviceRoleKey);
  const sql = postgres(databaseUrl, { max: 3 });
  const signingSecret = `whsec_${randomBytes(32).toString("base64")}`;
  const serviceRoleClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  try {
    const [settings] = await sql<{
      reads_enabled: boolean;
      writes_enabled: boolean;
    }[]>`
      select reads_enabled, writes_enabled
      from private.research_group_runtime_settings
      where singleton
    `;
    assert.deepEqual(settings, {
      reads_enabled: false,
      writes_enabled: false,
    });

    await sql`
      insert into profiles (owner_id, display_name)
      values
        (${ownerA}, 'Deletion Live A'),
        (${ownerB}, 'Deletion Live B'),
        (${ownerC}, 'Deletion Live C'),
        (${ownerD}, 'Deletion Live D')
    `;
    await sql`
      insert into collaboration_identities (owner_id, email_lookup_hash)
      values
        (${ownerA}, ${lookupHash(ownerA)}),
        (${ownerB}, ${lookupHash(ownerB)}),
        (${ownerC}, ${lookupHash(ownerC)}),
        (${ownerD}, ${lookupHash(ownerD)})
    `;

    const selectedGroup = await createGroup(sql, ownerA, [
      { id: ownerB, role: "admin" },
      { id: ownerC, role: "member" },
    ]);
    await sql`
      update research_groups
      set selected_successor_id = ${ownerC}
      where id = ${selectedGroup}::uuid
    `;
    const adminGroup = await createGroup(sql, ownerA, [
      { id: ownerB, role: "admin", joinedAt: "2026-02-01T00:00:00Z" },
      { id: ownerC, role: "member", joinedAt: "2026-01-01T00:00:00Z" },
    ]);
    const memberGroup = await createGroup(sql, ownerA, [
      { id: ownerB, role: "member", joinedAt: "2026-01-01T00:00:00Z" },
      { id: ownerC, role: "member", joinedAt: "2026-02-01T00:00:00Z" },
    ]);
    const ownerOnlyGroup = await createGroup(sql, ownerA);
    const unrelatedGroup = await createGroup(sql, ownerD, [
      { id: ownerA, role: "member" },
    ]);

    const firstEvent = await verifyWebhook(
      signedDeletionRequest(ownerA, signingSecret),
      { signingSecret },
    );
    assert.equal(firstEvent.type, "user.deleted");
    assert.equal(firstEvent.data.id, ownerA);
    const first = await handleDeletedClerkUser(
      firstEvent.data.id,
      serviceRoleClient,
    );

    const duplicateEvent = await verifyWebhook(
      signedDeletionRequest(ownerA, signingSecret),
      { signingSecret },
    );
    assert.equal(duplicateEvent.type, "user.deleted");
    assert.equal(duplicateEvent.data.id, ownerA);
    const duplicate = await handleDeletedClerkUser(
      duplicateEvent.data.id,
      serviceRoleClient,
    );
    assert.equal(first.status, 204);
    assert.equal(duplicate.status, 204);

    const [ownerRows, removedRows, deletedRows, identityRows, profileRows] =
      await Promise.all([
        sql<{ group_id: string; member_id: string }[]>`
          select group_id, member_id
          from research_group_members
          where group_id in (
            ${selectedGroup}::uuid,
            ${adminGroup}::uuid,
            ${memberGroup}::uuid
          )
            and role = 'owner'
            and revoked_at is null
        `,
        sql`
          select group_id
          from research_group_members
          where group_id = ${unrelatedGroup}::uuid
            and member_id = ${ownerA}
        `,
        sql`
          select id
          from research_groups
          where id = ${ownerOnlyGroup}::uuid
        `,
        sql`
          select owner_id
          from collaboration_identities
          where owner_id = ${ownerA}
        `,
        sql`
          select owner_id
          from profiles
          where owner_id = ${ownerA}
        `,
      ]);
    const ownerByGroup = new Map(
      ownerRows.map((membership) => [
        membership.group_id,
        membership.member_id,
      ]),
    );
    assert.equal(ownerByGroup.get(selectedGroup), ownerC);
    assert.equal(ownerByGroup.get(adminGroup), ownerB);
    assert.equal(ownerByGroup.get(memberGroup), ownerB);
    assert.equal(removedRows.length, 0);
    assert.equal(deletedRows.length, 0);
    assert.equal(identityRows.length, 0);
    assert.deepEqual([...profileRows], [{ owner_id: ownerA }]);
  } finally {
    try {
      await sql`
        delete from research_groups
        where id in (
          select group_id
          from research_group_members
          where member_id in ${sql(owners)}
        )
      `;
      await sql`
        delete from collaboration_identities
        where owner_id in ${sql(owners)}
      `;
      await sql`delete from profiles where owner_id in ${sql(owners)}`;

      const [residualRows, settings] = await Promise.all([
        sql<{ count: number }[]>`
          select (
            (select count(*) from profiles where owner_id in ${sql(owners)})
            + (
              select count(*)
              from collaboration_identities
              where owner_id in ${sql(owners)}
            )
            + (
              select count(*)
              from research_group_members
              where member_id in ${sql(owners)}
            )
          )::int as count
        `,
        sql<{ reads_enabled: boolean; writes_enabled: boolean }[]>`
          select reads_enabled, writes_enabled
          from private.research_group_runtime_settings
          where singleton
        `,
      ]);
      assert.equal(residualRows[0].count, 0);
      assert.deepEqual(settings[0], {
        reads_enabled: false,
        writes_enabled: false,
      });
    } finally {
      await sql.end();
    }
  }
});
