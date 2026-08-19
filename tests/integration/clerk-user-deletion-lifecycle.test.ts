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

async function callIdentitySync({
  ownerId,
  sourceUpdatedAt,
  hash,
  discoverableByEmail,
  groupInvitePolicy,
  allowSameSourceVersion,
}: {
  ownerId: string;
  sourceUpdatedAt: number;
  hash: string | null;
  discoverableByEmail?: boolean;
  groupInvitePolicy?: "nobody" | "friends_only" | "anyone";
  allowSameSourceVersion?: boolean;
}) {
  assert.ok(sql);
  const [result] = await sql<{ applied: boolean }[]>`
    select sync_clerk_collaboration_identity(
      ${ownerId},
      ${sourceUpdatedAt},
      ${hash},
      1,
      ${discoverableByEmail ?? null},
      ${groupInvitePolicy ?? null}::group_invite_policy,
      ${allowSameSourceVersion ?? false}
    ) as applied
  `;
  return result.applied;
}

async function findIdentity(requesterId: string, hash: string) {
  assert.ok(sql);
  return sql.begin(async (transaction) => {
    await transaction`
      select set_config(
        'request.jwt.claims',
        ${JSON.stringify({ sub: requesterId })},
        true
      )
    `;
    await transaction.unsafe("set local role authenticated");
    return transaction<{ public_id: string }[]>`
      select public_id from find_collaboration_profile(${hash})
    `;
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
  await sql`
    delete from collaboration_identities
    where owner_id in ${sql(owners)}
  `;
  await sql`
    delete from private.clerk_user_identity_sync_state
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

run("keeps the newest Clerk email hash and treats duplicate delivery as a no-op", async () => {
  assert.ok(sql);
  const oldHash = lookupHash(`${ownerA}-old`);
  const newHash = lookupHash(`${ownerA}-new`);

  await sql`
    update collaboration_identities
    set discoverable_by_email = true, group_invite_policy = 'anyone'
    where owner_id = ${ownerA}
  `;

  assert.equal(
    await callIdentitySync({
      ownerId: ownerA,
      sourceUpdatedAt: 200,
      hash: newHash,
    }),
    true,
  );
  assert.equal(
    await callIdentitySync({
      ownerId: ownerA,
      sourceUpdatedAt: 100,
      hash: oldHash,
    }),
    false,
  );
  assert.equal(
    await callIdentitySync({
      ownerId: ownerA,
      sourceUpdatedAt: 200,
      hash: newHash,
    }),
    false,
  );

  const [stored, foundNew, foundOld] = await Promise.all([
    sql<{
      email_lookup_hash: string;
      discoverable_by_email: boolean;
      group_invite_policy: string;
    }[]>`
      select email_lookup_hash, discoverable_by_email, group_invite_policy
      from collaboration_identities
      where owner_id = ${ownerA}
    `,
    findIdentity(ownerB, newHash),
    findIdentity(ownerB, oldHash),
  ]);

  assert.deepEqual([...stored], [
    {
      email_lookup_hash: newHash,
      discoverable_by_email: true,
      group_invite_policy: "anyone",
    },
  ]);
  assert.equal(foundNew.length, 1);
  assert.equal(foundOld.length, 0);

  assert.equal(
    await callIdentitySync({
      ownerId: ownerA,
      sourceUpdatedAt: 200,
      hash: newHash,
      discoverableByEmail: false,
      groupInvitePolicy: "nobody",
      allowSameSourceVersion: true,
    }),
    true,
  );
  const updatedPreferences = await sql<{
    discoverable_by_email: boolean;
    group_invite_policy: string;
  }[]>`
    select discoverable_by_email, group_invite_policy
    from collaboration_identities
    where owner_id = ${ownerA}
  `;
  assert.deepEqual([...updatedPreferences], [
    { discoverable_by_email: false, group_invite_policy: "nobody" },
  ]);
});

run("advances source state when identity becomes invalid and rejects stale recreation", async () => {
  assert.ok(sql);
  const staleHash = lookupHash(`${ownerA}-stale`);

  assert.equal(
    await callIdentitySync({
      ownerId: ownerA,
      sourceUpdatedAt: 300,
      hash: null,
    }),
    true,
  );
  assert.equal(
    await callIdentitySync({
      ownerId: ownerA,
      sourceUpdatedAt: 250,
      hash: staleHash,
    }),
    false,
  );

  const identities = await sql`
    select owner_id from collaboration_identities where owner_id = ${ownerA}
  `;
  assert.equal(identities.length, 0);
});

run("makes account deletion authoritative over late updates", async () => {
  assert.ok(sql);
  await callDeletion(sql, ownerA);

  assert.equal(
    await callIdentitySync({
      ownerId: ownerA,
      sourceUpdatedAt: 400,
      hash: lookupHash(`${ownerA}-late`),
    }),
    false,
  );

  const [identities, state] = await Promise.all([
    sql`select owner_id from collaboration_identities where owner_id = ${ownerA}`,
    sql<{ account_closed: boolean }[]>`
      select account_closed
      from private.clerk_user_identity_sync_state
      where owner_id = ${ownerA}
    `,
  ]);
  assert.equal(identities.length, 0);
  assert.deepEqual([...state], [{ account_closed: true }]);
});

run("rolls source state back when an email hash belongs to another identity", async () => {
  assert.ok(sql);
  const ownerBHash = lookupHash(ownerB);

  await assert.rejects(
    callIdentitySync({
      ownerId: ownerA,
      sourceUpdatedAt: 500,
      hash: ownerBHash,
    }),
    /duplicate key value violates unique constraint/,
  );

  const state = await sql`
    select source_updated_at
    from private.clerk_user_identity_sync_state
    where owner_id = ${ownerA}
  `;
  assert.equal(state.length, 0);
  assert.equal(
    await callIdentitySync({
      ownerId: ownerA,
      sourceUpdatedAt: 500,
      hash: lookupHash(`${ownerA}-safe`),
    }),
    true,
  );
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

run("exposes Clerk identity state and mutation RPCs only to service_role", async () => {
  assert.ok(sql);
  const [privileges] = await sql<{
    public_execute: boolean;
    anon_execute: boolean;
    authenticated_execute: boolean;
    service_role_execute: boolean;
    sync_public_execute: boolean;
    sync_anon_execute: boolean;
    sync_authenticated_execute: boolean;
    sync_service_role_execute: boolean;
    state_anon_access: boolean;
    state_authenticated_access: boolean;
    state_service_role_access: boolean;
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
      ) as service_role_execute,
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
          'public.sync_clerk_collaboration_identity(text,bigint,text,integer,boolean,group_invite_policy,boolean)'::regprocedure
          and privilege.grantee = 0
          and privilege.privilege_type = 'EXECUTE'
      ) as sync_public_execute,
      has_function_privilege(
        'anon',
        'public.sync_clerk_collaboration_identity(text,bigint,text,integer,boolean,group_invite_policy,boolean)',
        'execute'
      ) as sync_anon_execute,
      has_function_privilege(
        'authenticated',
        'public.sync_clerk_collaboration_identity(text,bigint,text,integer,boolean,group_invite_policy,boolean)',
        'execute'
      ) as sync_authenticated_execute,
      has_function_privilege(
        'service_role',
        'public.sync_clerk_collaboration_identity(text,bigint,text,integer,boolean,group_invite_policy,boolean)',
        'execute'
      ) as sync_service_role_execute,
      has_table_privilege(
        'anon',
        'private.clerk_user_identity_sync_state',
        'select,insert,update,delete'
      ) as state_anon_access,
      has_table_privilege(
        'authenticated',
        'private.clerk_user_identity_sync_state',
        'select,insert,update,delete'
      ) as state_authenticated_access,
      has_table_privilege(
        'service_role',
        'private.clerk_user_identity_sync_state',
        'select,insert,update'
      ) as state_service_role_access
  `;

  assert.deepEqual(privileges, {
    public_execute: false,
    anon_execute: false,
    authenticated_execute: false,
    service_role_execute: true,
    sync_public_execute: false,
    sync_anon_execute: false,
    sync_authenticated_execute: false,
    sync_service_role_execute: true,
    state_anon_access: false,
    state_authenticated_access: false,
    state_service_role_access: true,
  });

  const appliedAsServiceRole = await sql.begin(async (transaction) => {
    await transaction.unsafe("set local role service_role");
    const [result] = await transaction<{ applied: boolean }[]>`
      select sync_clerk_collaboration_identity(
        ${ownerA},
        600,
        ${lookupHash(`${ownerA}-service-role`)},
        1,
        null,
        null,
        false
      ) as applied
    `;
    return result.applied;
  });
  assert.equal(appliedAsServiceRole, true);
});
