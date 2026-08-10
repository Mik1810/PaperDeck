import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import postgres, { type Sql, type TransactionSql } from "postgres";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
const run = databaseUrl ? test : test.skip;
const ownerA = `clerk-delete-a-${randomUUID()}`;
const ownerB = `clerk-delete-b-${randomUUID()}`;
const ownerC = `clerk-delete-c-${randomUUID()}`;
const ownerD = `clerk-delete-d-${randomUUID()}`;
const owners = [ownerA, ownerB, ownerC, ownerD];
let sql: Sql | undefined;

function lookupHash(ownerId: string) {
  return createHash("sha256").update(ownerId).digest("hex");
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
      values ('Synthetic deletion lifecycle group')
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

async function callDeletion(
  executor: Sql | TransactionSql,
  ownerId: string,
) {
  const [result] = await executor<{
    groups_transferred: number;
    groups_deleted: number;
    memberships_removed: number;
    collaboration_identities_removed: number;
  }[]>`select * from handle_clerk_user_deleted(${ownerId})`;
  return result;
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
  await sql`
    delete from collaboration_identities
    where owner_id in ${sql(owners)}
  `;
}

before(async () => {
  if (!databaseUrl) return;
  sql = postgres(databaseUrl, { max: 3, prepare: false });
  await sql`
    insert into profiles (owner_id, display_name)
    values
      (${ownerA}, 'Deletion A'),
      (${ownerB}, 'Deletion B'),
      (${ownerC}, 'Deletion C'),
      (${ownerD}, 'Deletion D')
  `;
});

beforeEach(async () => {
  if (!sql) return;
  await cleanupFixtures();
  await sql`
    insert into collaboration_identities (owner_id, email_lookup_hash)
    values
      (${ownerA}, ${lookupHash(ownerA)}),
      (${ownerB}, ${lookupHash(ownerB)}),
      (${ownerC}, ${lookupHash(ownerC)}),
      (${ownerD}, ${lookupHash(ownerD)})
  `;
});

after(async () => {
  if (!sql) return;
  await cleanupFixtures();
  await sql`delete from profiles where owner_id in ${sql(owners)}`;
  await sql.end();
});

run("atomically transfers owned groups, removes other memberships, and is idempotent", async () => {
  assert.ok(sql);
  const ownedGroup = await createGroup(ownerA, [
    { id: ownerB, role: "admin" },
    { id: ownerC, role: "member" },
  ]);
  await sql`
    update research_groups
    set selected_successor_id = ${ownerC}
    where id = ${ownedGroup}::uuid
  `;
  const memberGroup = await createGroup(ownerD, [
    { id: ownerA, role: "member" },
  ]);

  const first = await callDeletion(sql, ownerA);
  const second = await callDeletion(sql, ownerA);

  assert.deepEqual(first, {
    groups_transferred: 1,
    groups_deleted: 0,
    memberships_removed: 2,
    collaboration_identities_removed: 1,
  });
  assert.deepEqual(second, {
    groups_transferred: 0,
    groups_deleted: 0,
    memberships_removed: 0,
    collaboration_identities_removed: 0,
  });

  const [ownerRows, deletedIdentity, removedMembership] = await Promise.all([
    sql`
      select member_id
      from research_group_members
      where group_id = ${ownedGroup}::uuid
        and role = 'owner'
        and revoked_at is null
    `,
    sql`
      select owner_id
      from collaboration_identities
      where owner_id = ${ownerA}
    `,
    sql`
      select member_id
      from research_group_members
      where group_id = ${memberGroup}::uuid
        and member_id = ${ownerA}
    `,
  ]);
  assert.deepEqual([...ownerRows], [{ member_id: ownerC }]);
  assert.equal(deletedIdentity.length, 0);
  assert.equal(removedMembership.length, 0);
});

run("deletes an owner-only group in the same identity-cleanup transaction", async () => {
  assert.ok(sql);
  const groupId = await createGroup(ownerB);

  const result = await callDeletion(sql, ownerB);
  const [groupRows, identityRows] = await Promise.all([
    sql`select id from research_groups where id = ${groupId}::uuid`,
    sql`
      select owner_id
      from collaboration_identities
      where owner_id = ${ownerB}
    `,
  ]);

  assert.deepEqual(result, {
    groups_transferred: 0,
    groups_deleted: 1,
    memberships_removed: 1,
    collaboration_identities_removed: 1,
  });
  assert.equal(groupRows.length, 0);
  assert.equal(identityRows.length, 0);
});

run("preserves oldest-admin then oldest-member fallback precedence", async () => {
  assert.ok(sql);
  const adminGroup = await createGroup(ownerA, [
    { id: ownerB, role: "admin", joinedAt: "2026-02-01T00:00:00Z" },
    { id: ownerC, role: "member", joinedAt: "2026-01-01T00:00:00Z" },
  ]);
  const memberGroup = await createGroup(ownerA, [
    { id: ownerB, role: "member", joinedAt: "2026-01-01T00:00:00Z" },
    { id: ownerC, role: "member", joinedAt: "2026-02-01T00:00:00Z" },
  ]);

  const result = await callDeletion(sql, ownerA);
  const ownersAfter = await sql<{ group_id: string; member_id: string }[]>`
    select group_id, member_id
    from research_group_members
    where group_id in (${adminGroup}::uuid, ${memberGroup}::uuid)
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

  assert.equal(result.groups_transferred, 2);
  assert.equal(ownerByGroup.get(adminGroup), ownerB);
  assert.equal(ownerByGroup.get(memberGroup), ownerB);
});

run("rolls succession back when collaboration identity cleanup fails", async () => {
  assert.ok(sql);
  const groupId = await createGroup(ownerA, [
    { id: ownerB, role: "admin" },
  ]);

  await assert.rejects(
    sql.begin(async (transaction) => {
      await transaction.unsafe(`
        create function public.paperdeck_test_reject_identity_delete()
        returns trigger
        language plpgsql
        as $function$
        begin
          raise exception 'synthetic_identity_delete_failure';
        end;
        $function$;

        create trigger paperdeck_test_reject_identity_delete
        before delete on public.collaboration_identities
        for each row
        execute function public.paperdeck_test_reject_identity_delete();
      `);
      await callDeletion(transaction, ownerA);
    }),
    /synthetic_identity_delete_failure/,
  );

  const [ownerRows, identityRows] = await Promise.all([
    sql`
      select member_id
      from research_group_members
      where group_id = ${groupId}::uuid
        and role = 'owner'
        and revoked_at is null
    `,
    sql`
      select owner_id
      from collaboration_identities
      where owner_id = ${ownerA}
    `,
  ]);
  assert.deepEqual([...ownerRows], [{ member_id: ownerA }]);
  assert.deepEqual([...identityRows], [{ owner_id: ownerA }]);
});

run("serializes duplicate delivery and performs lifecycle work once", async () => {
  assert.ok(sql);
  const groupId = await createGroup(ownerA, [
    { id: ownerB, role: "admin" },
  ]);

  const results = await Promise.all([
    callDeletion(sql, ownerA),
    callDeletion(sql, ownerA),
  ]);
  assert.equal(
    results.reduce((sum, result) => sum + result.groups_transferred, 0),
    1,
  );
  assert.equal(
    results.reduce(
      (sum, result) => sum + result.collaboration_identities_removed,
      0,
    ),
    1,
  );

  const ownersAfter = await sql`
    select member_id
    from research_group_members
    where group_id = ${groupId}::uuid
      and role = 'owner'
      and revoked_at is null
  `;
  assert.deepEqual([...ownersAfter], [{ member_id: ownerB }]);
});

run("exposes the lifecycle RPC only to service_role", async () => {
  assert.ok(sql);
  const [privileges] = await sql<{
    public_execute: boolean;
    anon_execute: boolean;
    authenticated_execute: boolean;
    service_role_execute: boolean;
  }[]>`
    select
      exists (
        select 1
        from pg_proc as procedure
        cross join lateral aclexplode(
          coalesce(
            procedure.proacl,
            acldefault('f', procedure.proowner)
          )
        ) as privilege
        where procedure.oid =
          'public.handle_clerk_user_deleted(text)'::regprocedure
          and privilege.grantee = 0
          and privilege.privilege_type = 'EXECUTE'
      ) as public_execute,
      has_function_privilege(
        'anon',
        'public.handle_clerk_user_deleted(text)',
        'execute'
      ) as anon_execute,
      has_function_privilege(
        'authenticated',
        'public.handle_clerk_user_deleted(text)',
        'execute'
      ) as authenticated_execute,
      has_function_privilege(
        'service_role',
        'public.handle_clerk_user_deleted(text)',
        'execute'
      ) as service_role_execute
  `;

  assert.deepEqual(privileges, {
    public_execute: false,
    anon_execute: false,
    authenticated_execute: false,
    service_role_execute: true,
  });
});
