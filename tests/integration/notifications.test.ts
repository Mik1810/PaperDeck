import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import postgres, { type Sql, type TransactionSql } from "postgres";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.PAPERDECK_RUN_NOTIFICATIONS_INTEGRATION === "true";
const run = databaseUrl && enabled ? test : test.skip;
const ownerA = `notification-test-a-${randomUUID()}`;
const ownerB = `notification-test-b-${randomUUID()}`;
const ownerC = `notification-test-c-${randomUUID()}`;
const owners = [ownerA, ownerB, ownerC];
let sql: Sql | undefined;

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function asUser<T>(
  ownerId: string,
  task: (transaction: TransactionSql) => Promise<T>,
) {
  assert.ok(sql);
  return sql.begin(async (transaction) => {
    await transaction`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId })}, true)`;
    await transaction.unsafe("set local role authenticated");
    return task(transaction);
  });
}

async function createFriendRequest() {
  assert.ok(sql);
  const [request] = await sql<{ id: string }[]>`
    insert into friend_requests (requester_id, recipient_id)
    values (${ownerA}, ${ownerB})
    returning id
  `;
  return request.id;
}

async function createGroup() {
  assert.ok(sql);
  return sql.begin(async (transaction) => {
    const [group] = await transaction<{ id: string }[]>`
      insert into research_groups (name)
      values ('Notification fixture group')
      returning id
    `;
    await transaction`
      insert into research_group_members (group_id, member_id, role)
      values (${group.id}::uuid, ${ownerA}, 'owner')
    `;
    return group.id;
  });
}

async function cleanupFixtures() {
  assert.ok(sql);
  await sql`
    delete from research_groups
    where id in (
      select group_id
      from research_group_members
      where member_id in ${sql(owners)}
    )
  `;
  await sql`delete from profiles where owner_id in ${sql(owners)}`;
}

before(async () => {
  if (!databaseUrl || !enabled) return;
  sql = postgres(databaseUrl, { max: 4, prepare: false });
  const relation = await sql<{ exists: boolean }[]>`
    select to_regclass('public.notifications') is not null as exists
  `;
  assert.equal(relation[0]?.exists, true, "notification migration is required");
});

beforeEach(async () => {
  if (!sql) return;
  await cleanupFixtures();
  await sql`
    insert into profiles (owner_id, display_name)
    values
      (${ownerA}, 'Notification A'),
      (${ownerB}, 'Notification B'),
      (${ownerC}, 'Notification C')
  `;
  await sql`
    insert into collaboration_identities (owner_id, email_lookup_hash)
    values
      (${ownerA}, ${digest(ownerA)}),
      (${ownerB}, ${digest(ownerB)}),
      (${ownerC}, ${digest(ownerC)})
  `;
});

after(async () => {
  if (!sql) return;
  try {
    await cleanupFixtures();
  } finally {
    await sql.end();
  }
});

run("creates friend notifications atomically and deduplicates status delivery", async () => {
  assert.ok(sql);
  const requestId = await createFriendRequest();

  const received = await sql<{ recipient_id: string; actor_id: string; type: string }[]>`
    select recipient_id, actor_id, type
    from notifications
    where friend_request_id = ${requestId}::uuid
  `;
  assert.deepEqual([...received], [{
    recipient_id: ownerB,
    actor_id: ownerA,
    type: "friend_request_received",
  }]);

  await sql`
    update friend_requests
    set status = 'accepted', responded_at = now(), updated_at = now()
    where id = ${requestId}::uuid
  `;
  await sql`
    update friend_requests
    set status = 'accepted', updated_at = now()
    where id = ${requestId}::uuid
  `;

  const accepted = await sql<{ count: number }[]>`
    select count(*)::integer as count
    from notifications
    where friend_request_id = ${requestId}::uuid
      and type = 'friendship_accepted'
      and recipient_id = ${ownerA}
      and actor_id = ${ownerB}
  `;
  assert.equal(accepted[0].count, 1);
});

run("isolates recipients and only permits read/archive acknowledgement", async () => {
  assert.ok(sql);
  const requestId = await createFriendRequest();
  const rows = await asUser(ownerB, (transaction) => transaction<{ id: string }[]>`
    select id from notifications
  `);
  assert.equal(rows.length, 1);

  const hidden = await asUser(ownerC, (transaction) => transaction<{ count: number }[]>`
    select count(*)::integer as count from notifications
  `);
  assert.equal(hidden[0].count, 0);

  await asUser(ownerB, (transaction) => transaction`
    update notifications set read_at = now()
    where id = ${rows[0].id}::uuid
  `);
  await assert.rejects(
    asUser(ownerB, (transaction) => transaction`
      update notifications set type = 'friendship_accepted'
      where id = ${rows[0].id}::uuid
    `),
    /permission denied/,
  );

  await sql`delete from friend_requests where id = ${requestId}::uuid`;
  const cascaded = await sql<{ count: number }[]>`
    select count(*)::integer as count
    from notifications
    where id = ${rows[0].id}::uuid
  `;
  assert.equal(cascaded[0].count, 0);
});

run("emits group lifecycle notifications and removes them with the group", async () => {
  assert.ok(sql);
  const groupId = await createGroup();
  await sql`
    insert into research_group_members (group_id, member_id, role)
    values (${groupId}::uuid, ${ownerB}, 'member')
  `;
  await sql`
    update research_group_members
    set role = 'admin', updated_at = now()
    where group_id = ${groupId}::uuid and member_id = ${ownerB}
  `;
  await sql`
    update research_group_members
    set revoked_at = now(), updated_at = now()
    where group_id = ${groupId}::uuid and member_id = ${ownerB}
  `;

  const rows = await sql<{ recipient_id: string; type: string }[]>`
    select recipient_id, type
    from notifications
    where group_id = ${groupId}::uuid
    order by created_at, type
  `;
  assert.deepEqual([...rows], [
    { recipient_id: ownerA, type: "group_member_joined" },
    { recipient_id: ownerB, type: "group_role_changed" },
    { recipient_id: ownerB, type: "group_membership_ended" },
  ]);

  await sql`delete from research_groups where id = ${groupId}::uuid`;
  const remaining = await sql<{ count: number }[]>`
    select count(*)::integer as count
    from notifications
    where group_id = ${groupId}::uuid
  `;
  assert.equal(remaining[0].count, 0);
});

run("does not duplicate invitation acceptance as an inviter join event", async () => {
  assert.ok(sql);
  const groupId = await createGroup();
  await sql`
    insert into research_group_members (group_id, member_id, role)
    values (${groupId}::uuid, ${ownerC}, 'member')
  `;
  await sql`delete from notifications where group_id = ${groupId}::uuid`;

  const [invitation] = await sql<{ id: string }[]>`
    insert into research_group_invitations (
      group_id,
      inviter_id,
      recipient_id,
      token_digest
    ) values (
      ${groupId}::uuid,
      ${ownerA},
      ${ownerB},
      ${digest("notification-invitation")}
    )
    returning id
  `;
  await sql`
    insert into research_group_members (group_id, member_id, role)
    values (${groupId}::uuid, ${ownerB}, 'member')
  `;
  await sql`
    update research_group_invitations
    set
      status = 'accepted',
      token_digest = null,
      resolved_at = now(),
      updated_at = now()
    where id = ${invitation.id}::uuid
  `;

  const rows = await sql<{ recipient_id: string; type: string }[]>`
    select recipient_id, type
    from notifications
    where group_id = ${groupId}::uuid
    order by recipient_id, type
  `;
  assert.deepEqual([...rows], [
    { recipient_id: ownerA, type: "group_invitation_accepted" },
    { recipient_id: ownerB, type: "group_invitation_received" },
    { recipient_id: ownerC, type: "group_member_joined" },
  ]);
});

run("purges expired rows in bounded batches and keeps the helper private", async () => {
  assert.ok(sql);
  const requestId = await createFriendRequest();
  await sql`
    update notifications
    set created_at = now() - interval '100 days',
        expires_at = now() - interval '10 days'
    where friend_request_id = ${requestId}::uuid
  `;

  await assert.rejects(
    asUser(ownerB, (transaction) => transaction`
      select private.purge_expired_notifications(10)
    `),
    /permission denied/,
  );
  const purged = await sql<{ count: number }[]>`
    select private.purge_expired_notifications(10) as count
  `;
  assert.equal(purged[0].count, 1);
});
