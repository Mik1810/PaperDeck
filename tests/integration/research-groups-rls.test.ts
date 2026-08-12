import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import postgres, { type Sql, type TransactionSql } from "postgres";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
const run = databaseUrl ? test : test.skip;
const ownerA = `group-test-a-${randomUUID()}`;
const ownerB = `group-test-b-${randomUUID()}`;
const ownerC = `group-test-c-${randomUUID()}`;
const ownerD = `group-test-d-${randomUUID()}`;
const owners = [ownerA, ownerB, ownerC, ownerD];
let sql: Sql | undefined;
let originalReadsEnabled = false;
let originalWritesEnabled = false;

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

async function createGroup(
  ownerId: string,
  members: Array<{
    id: string;
    role: "admin" | "member";
    joinedAt?: string;
  }> = [],
) {
  assert.ok(sql);
  return sql.begin(async (transaction) => {
    const [group] = await transaction<{ id: string }[]>`
      insert into research_groups (name)
      values ('Synthetic private group')
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

before(async () => {
  if (!databaseUrl) return;
  sql = postgres(databaseUrl, { max: 3, prepare: false });

  const settings = await sql<{
    reads_enabled: boolean;
    writes_enabled: boolean;
  }[]>`
    select reads_enabled, writes_enabled
    from private.research_group_runtime_settings
    where singleton
  `;
  originalReadsEnabled = settings[0].reads_enabled;
  originalWritesEnabled = settings[0].writes_enabled;

  await sql`
    update private.research_group_runtime_settings
    set reads_enabled = true, writes_enabled = true, updated_at = now()
    where singleton
  `;
  await sql`
    insert into profiles (owner_id, display_name)
    values
      (${ownerA}, 'Group A'),
      (${ownerB}, 'Group B'),
      (${ownerC}, 'Group C'),
      (${ownerD}, 'Group D')
  `;
});

beforeEach(async () => {
  if (!sql) return;
  await sql`
    delete from research_groups
    where id in (
      select group_id
      from research_group_members
      where member_id in ${sql(owners)}
    )
  `;
});

after(async () => {
  if (!sql) return;
  await sql`
    delete from research_groups
    where id in (
      select group_id
      from research_group_members
      where member_id in ${sql(owners)}
    )
  `;
  await sql`delete from profiles where owner_id in ${sql(owners)}`;
  await sql`
    update private.research_group_runtime_settings
    set
      reads_enabled = ${originalReadsEnabled},
      writes_enabled = ${originalWritesEnabled},
      updated_at = now()
    where singleton
  `;
  await sql.end();
});

run("RLS reveals groups to active members but not outsiders or revoked members", async () => {
  assert.ok(sql);
  const groupId = await createGroup(ownerA, [
    { id: ownerB, role: "admin" },
    { id: ownerC, role: "member" },
  ]);
  await sql`
    update research_group_members
    set revoked_at = now()
    where group_id = ${groupId}::uuid and member_id = ${ownerC}
  `;

  for (const allowedOwner of [ownerA, ownerB]) {
    const groups = await asUser(
      allowedOwner,
      (transaction) =>
        transaction`select id from research_groups where id = ${groupId}::uuid`,
    );
    assert.equal(groups.length, 1);
  }

  for (const deniedOwner of [ownerC, ownerD]) {
    const groups = await asUser(
      deniedOwner,
      (transaction) =>
        transaction`select id from research_groups where id = ${groupId}::uuid`,
    );
    assert.equal(groups.length, 0);
  }
});

run("raw membership reads expose only the caller's own active ACL row", async () => {
  const groupId = await createGroup(ownerA, [
    { id: ownerB, role: "admin" },
    { id: ownerC, role: "member" },
  ]);
  const rows = await asUser(
    ownerB,
    (transaction) =>
      transaction<{ member_id: string; role: string }[]>`
        select member_id, role
        from research_group_members
        where group_id = ${groupId}::uuid
      `,
  );

  assert.deepEqual([...rows], [{ member_id: ownerB, role: "admin" }]);
});

run("authenticated clients cannot write group or membership rows directly", async () => {
  const groupId = await createGroup(ownerA);

  await assert.rejects(
    asUser(
      ownerA,
      (transaction) =>
        transaction`
          update research_groups
          set name = 'Bypassed ACL'
          where id = ${groupId}::uuid
        `,
    ),
    /permission denied/,
  );
  await assert.rejects(
    asUser(
      ownerA,
      (transaction) =>
        transaction`
          insert into research_group_members (group_id, member_id, role)
          values (${groupId}::uuid, ${ownerB}, 'member')
        `,
    ),
    /permission denied/,
  );
});

run("deferred invariants require one owner and a valid active successor", async () => {
  assert.ok(sql);
  await assert.rejects(
    sql.begin(async (transaction) => {
      await transaction`
        insert into research_groups (name)
        values ('Ownerless group')
      `;
    }),
    /research_group_requires_exactly_one_owner/,
  );

  const groupId = await createGroup(ownerA, [{ id: ownerB, role: "member" }]);
  await assert.rejects(
    sql.begin(async (transaction) => {
      await transaction`
        update research_groups
        set selected_successor_id = ${ownerD}
        where id = ${groupId}::uuid
      `;
    }),
    /research_group_successor_must_be_active_non_owner/,
  );
  await assert.rejects(
    sql.begin(async (transaction) => {
      await transaction`
        delete from research_group_members
        where group_id = ${groupId}::uuid and member_id = ${ownerA}
      `;
    }),
    /research_group_requires_exactly_one_owner/,
  );
});

run("account closure follows selected, admin, member, then delete precedence", async () => {
  assert.ok(sql);
  const selectedGroup = await createGroup(ownerA, [
    { id: ownerB, role: "admin", joinedAt: "2026-01-01T00:00:00Z" },
    { id: ownerC, role: "member", joinedAt: "2026-02-01T00:00:00Z" },
  ]);
  await sql`
    update research_groups
    set selected_successor_id = ${ownerC}
    where id = ${selectedGroup}::uuid
  `;

  const adminGroup = await createGroup(ownerA, [
    { id: ownerB, role: "admin", joinedAt: "2026-02-01T00:00:00Z" },
    { id: ownerC, role: "member", joinedAt: "2026-01-01T00:00:00Z" },
  ]);
  const memberGroup = await createGroup(ownerA, [
    { id: ownerB, role: "member", joinedAt: "2026-01-01T00:00:00Z" },
    { id: ownerC, role: "member", joinedAt: "2026-02-01T00:00:00Z" },
  ]);
  const deletedGroup = await createGroup(ownerA);

  const [result] = await sql<{
    groups_transferred: number;
    groups_deleted: number;
    memberships_removed: number;
  }[]>`select * from handle_research_group_account_closure(${ownerA})`;
  assert.equal(result.groups_transferred, 3);
  assert.equal(result.groups_deleted, 1);
  assert.equal(result.memberships_removed, 4);

  const ownersAfter = await sql<{ group_id: string; member_id: string }[]>`
    select group_id, member_id
    from research_group_members
    where group_id in (
      ${selectedGroup}::uuid,
      ${adminGroup}::uuid,
      ${memberGroup}::uuid
    )
      and role = 'owner'
      and revoked_at is null
    order by group_id
  `;
  const ownerByGroup = new Map(
    ownersAfter.map((membership) => [
      membership.group_id,
      membership.member_id,
    ]),
  );
  assert.equal(ownerByGroup.get(selectedGroup), ownerC);
  assert.equal(ownerByGroup.get(adminGroup), ownerB);
  assert.equal(ownerByGroup.get(memberGroup), ownerB);

  const deleted = await sql`
    select id from research_groups where id = ${deletedGroup}::uuid
  `;
  assert.equal(deleted.length, 0);
});

run("concurrent account-closure calls serialize and remain idempotent", async () => {
  assert.ok(sql);
  const groupId = await createGroup(ownerA, [
    { id: ownerB, role: "admin" },
  ]);

  const [first, second] = await Promise.all([
    sql`select * from handle_research_group_account_closure(${ownerA})`,
    sql`select * from handle_research_group_account_closure(${ownerA})`,
  ]);
  const transferred =
    Number(first[0].groups_transferred) + Number(second[0].groups_transferred);
  assert.equal(transferred, 1);

  const ownerRows = await sql`
    select member_id
    from research_group_members
    where group_id = ${groupId}::uuid
      and role = 'owner'
      and revoked_at is null
  `;
  assert.deepEqual([...ownerRows], [{ member_id: ownerB }]);
});

run("concurrent closure of an owner and successor cannot orphan the group", async () => {
  assert.ok(sql);
  const groupId = await createGroup(ownerA, [
    { id: ownerB, role: "admin" },
    { id: ownerC, role: "member" },
  ]);
  await sql`
    update research_groups
    set selected_successor_id = ${ownerB}
    where id = ${groupId}::uuid
  `;

  await Promise.all([
    sql`select * from handle_research_group_account_closure(${ownerA})`,
    sql`select * from handle_research_group_account_closure(${ownerB})`,
  ]);

  const ownerRows = await sql`
    select member_id
    from research_group_members
    where group_id = ${groupId}::uuid
      and role = 'owner'
      and revoked_at is null
  `;
  assert.deepEqual([...ownerRows], [{ member_id: ownerC }]);
});

run("the kill switch hides reads without changing group data", async () => {
  assert.ok(sql);
  const groupId = await createGroup(ownerA);
  await sql`
    update private.research_group_runtime_settings
    set reads_enabled = false, updated_at = now()
    where singleton
  `;

  try {
    const hidden = await asUser(
      ownerA,
      (transaction) =>
        transaction`select id from research_groups where id = ${groupId}::uuid`,
    );
    assert.equal(hidden.length, 0);
    const stored = await sql`
      select id from research_groups where id = ${groupId}::uuid
    `;
    assert.equal(stored.length, 1);
  } finally {
    await sql`
      update private.research_group_runtime_settings
      set reads_enabled = true, updated_at = now()
      where singleton
    `;
  }
});

run("group lifecycle never mutates private playlists or ranking signals", async () => {
  assert.ok(sql);
  const groupId = await createGroup(ownerA, [
    { id: ownerB, role: "member" },
  ]);
  const [playlist] = await sql<{ id: string }[]>`
    insert into playlists (owner_id, name)
    values (${ownerA}, ${`Private-${randomUUID()}`})
    returning id
  `;
  const before = await sql<{
    batchItems: number;
    interactions: number;
    impressions: number;
    recommendations: number;
  }[]>`
    select
      (select count(*)::int from recommendation_batch_items where owner_id in ${sql(owners)}) as "batchItems",
      (select count(*)::int from user_paper_interactions where owner_id in ${sql(owners)}) as interactions,
      (select count(*)::int from recommendation_impressions where owner_id in ${sql(owners)}) as impressions,
      (select count(*)::int from recommendations where owner_id in ${sql(owners)}) as recommendations
  `;

  await sql`select * from handle_research_group_account_closure(${ownerA})`;

  const afterSignals = await sql<{
    batchItems: number;
    interactions: number;
    impressions: number;
    recommendations: number;
  }[]>`
    select
      (select count(*)::int from recommendation_batch_items where owner_id in ${sql(owners)}) as "batchItems",
      (select count(*)::int from user_paper_interactions where owner_id in ${sql(owners)}) as interactions,
      (select count(*)::int from recommendation_impressions where owner_id in ${sql(owners)}) as impressions,
      (select count(*)::int from recommendations where owner_id in ${sql(owners)}) as recommendations
  `;
  const playlistAfter = await sql`
    select id from playlists where id = ${playlist.id}::uuid
  `;
  const groupAfter = await sql`
    select id from research_groups where id = ${groupId}::uuid
  `;

  assert.deepEqual(afterSignals, before);
  assert.equal(playlistAfter.length, 1);
  assert.equal(groupAfter.length, 1);

  await sql`delete from playlists where id = ${playlist.id}::uuid`;
});
