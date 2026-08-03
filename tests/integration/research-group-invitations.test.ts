import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import postgres, { type Sql, type TransactionSql } from "postgres";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
const enabled =
  process.env.PAPERDECK_RUN_GROUP_INVITES_INTEGRATION === "true";
const run = databaseUrl && enabled ? test : test.skip;
const ownerA = `invite-test-a-${randomUUID()}`;
const ownerB = `invite-test-b-${randomUUID()}`;
const ownerC = `invite-test-c-${randomUUID()}`;
const ownerD = `invite-test-d-${randomUUID()}`;
const ownerE = `invite-test-e-${randomUUID()}`;
const owners = [ownerA, ownerB, ownerC, ownerD, ownerE];
let sql: Sql | undefined;
let originalReadsEnabled = false;
let originalWritesEnabled = false;
let publicIds: Record<string, string> = {};

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

async function createGroup(
  groupOwnerId = ownerA,
  members: Array<{ id: string; role: "admin" | "member" }> = [],
) {
  assert.ok(sql);
  return sql.begin(async (transaction) => {
    const [group] = await transaction<{ id: string }[]>`
      insert into research_groups (name)
      values ('Synthetic invitation group')
      returning id
    `;
    await transaction`
      insert into research_group_members (group_id, member_id, role)
      values (${group.id}::uuid, ${groupOwnerId}, 'owner')
    `;
    for (const member of members) {
      await transaction`
        insert into research_group_members (group_id, member_id, role)
        values (${group.id}::uuid, ${member.id}, ${member.role})
      `;
    }
    return group.id;
  });
}

async function createInvitation(
  actorId: string,
  groupId: string,
  recipientId: string,
  token: string,
) {
  assert.ok(sql);
  const [row] = await sql<{ id: string }[]>`
    select create_research_group_invitation(
      ${actorId},
      ${groupId}::uuid,
      ${publicIds[recipientId]}::uuid,
      ${digest(token)}
    ) as id
  `;
  return row.id;
}

async function respond(
  actorId: string,
  invitationId: string,
  token: string,
  accept: boolean,
  executor: Sql | TransactionSql = sql!,
) {
  const [row] = await executor<{ status: string }[]>`
    select respond_research_group_invitation(
      ${actorId},
      ${invitationId}::uuid,
      ${digest(token)},
      ${accept}
    ) as status
  `;
  return row.status;
}

async function respondInApp(
  actorId: string,
  invitationId: string,
  accept: boolean,
  executor: Sql | TransactionSql = sql!,
) {
  const [row] = await executor<{ status: string }[]>`
    select respond_research_group_invitation_in_app(
      ${actorId},
      ${invitationId}::uuid,
      ${accept}
    ) as status
  `;
  return row.status;
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
    delete from user_blocks
    where blocker_id in ${sql(owners)} or blocked_id in ${sql(owners)}
  `;
  await sql`
    delete from friendships
    where user_low_id in ${sql(owners)} or user_high_id in ${sql(owners)}
  `;
}

before(async () => {
  if (!databaseUrl || !enabled) return;
  sql = postgres(databaseUrl, { max: 4 });
  const relation = await sql<{ exists: boolean }[]>`
    select to_regclass('public.research_group_invitations') is not null as exists
  `;
  assert.equal(relation[0]?.exists, true, "invitation migration is required");

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
      (${ownerA}, 'Invite A'),
      (${ownerB}, 'Invite B'),
      (${ownerC}, 'Invite C'),
      (${ownerD}, 'Invite D'),
      (${ownerE}, 'Invite E')
  `;
});

beforeEach(async () => {
  if (!sql) return;
  await cleanupFixtures();
  await sql`
    insert into collaboration_identities (
      owner_id,
      email_lookup_hash,
      discoverable_by_email,
      group_invite_policy
    ) values
      (${ownerA}, ${digest(ownerA)}, true, 'anyone'),
      (${ownerB}, ${digest(ownerB)}, true, 'friends_only'),
      (${ownerC}, ${digest(ownerC)}, true, 'anyone'),
      (${ownerD}, ${digest(ownerD)}, true, 'nobody'),
      (${ownerE}, ${digest(ownerE)}, true, 'anyone')
    on conflict (owner_id) do update set
      discoverable_by_email = excluded.discoverable_by_email,
      group_invite_policy = excluded.group_invite_policy
  `;
  const identities = await sql<{ owner_id: string; public_id: string }[]>`
    select owner_id, public_id
    from collaboration_identities
    where owner_id in ${sql(owners)}
  `;
  publicIds = Object.fromEntries(
    identities.map((identity) => [identity.owner_id, identity.public_id]),
  );
});

after(async () => {
  if (!sql) return;
  await cleanupFixtures();
  await sql`delete from collaboration_identities where owner_id in ${sql(owners)}`;
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

run("enforces role, discoverability, target policy, friendship, and block checks", async () => {
  assert.ok(sql);
  const groupId = await createGroup(ownerA, [{ id: ownerE, role: "member" }]);
  await sql`
    insert into friendships (user_low_id, user_high_id)
    values (least(${ownerA}, ${ownerB}), greatest(${ownerA}, ${ownerB}))
  `;

  await createInvitation(ownerA, groupId, ownerB, "friend");
  await createInvitation(ownerA, groupId, ownerC, "anyone");
  await assert.rejects(
    createInvitation(ownerA, groupId, ownerD, "nobody"),
    /research_group_unavailable/,
  );
  await assert.rejects(
    createInvitation(ownerE, groupId, ownerB, "member"),
    /research_group_unavailable/,
  );

  await sql`
    insert into user_blocks (blocker_id, blocked_id)
    values (${ownerC}, ${ownerA})
  `;
  await assert.rejects(
    createInvitation(ownerA, groupId, ownerC, "blocked"),
    /research_group_unavailable/,
  );
});

run("accepts once, clears token material, and serializes duplicate delivery", async () => {
  assert.ok(sql);
  const groupId = await createGroup();
  const invitationId = await createInvitation(ownerA, groupId, ownerC, "accept");

  const results = await Promise.all([
    respond(ownerC, invitationId, "accept", true),
    respond(ownerC, invitationId, "accept", true),
  ]);
  assert.deepEqual(results, ["accepted", "accepted"]);

  const [invitation, memberships] = await Promise.all([
    sql<{ status: string; token_digest: string | null }[]>`
      select status, token_digest
      from research_group_invitations
      where id = ${invitationId}::uuid
    `,
    sql<{ count: number }[]>`
      select count(*)::integer as count
      from research_group_members
      where group_id = ${groupId}::uuid
        and member_id = ${ownerC}
        and revoked_at is null
    `,
  ]);
  assert.deepEqual([...invitation], [{
    status: "accepted",
    token_digest: null,
  }]);
  assert.equal(memberships[0].count, 1);
});

run("responds in app only as the recipient and consumes token material", async () => {
  assert.ok(sql);
  const groupId = await createGroup();
  const invitationId = await createInvitation(ownerA, groupId, ownerC, "in-app");

  await assert.rejects(
    respondInApp(ownerB, invitationId, true),
    /invitation_unavailable/,
  );
  assert.equal(await respondInApp(ownerC, invitationId, true), "accepted");
  assert.equal(await respondInApp(ownerC, invitationId, true), "accepted");

  const [invitation, membership] = await Promise.all([
    sql<{ status: string; token_digest: string | null }[]>`
      select status, token_digest
      from research_group_invitations
      where id = ${invitationId}::uuid
    `,
    sql<{ count: number }[]>`
      select count(*)::integer as count
      from research_group_members
      where group_id = ${groupId}::uuid
        and member_id = ${ownerC}
        and revoked_at is null
    `,
  ]);
  assert.deepEqual([...invitation], [{ status: "accepted", token_digest: null }]);
  assert.equal(membership[0].count, 1);
});

run("rejects tampered, expired, blocked-after-create, and stale-policy acceptance", async () => {
  assert.ok(sql);
  const groupId = await createGroup();

  const tamperedId = await createInvitation(ownerA, groupId, ownerC, "tampered");
  await assert.rejects(
    respond(ownerC, tamperedId, "wrong", true),
    /invitation_unavailable/,
  );

  await sql`
    update research_group_invitations
    set
      created_at = now() - interval '8 days',
      expires_at = now() - interval '1 day'
    where id = ${tamperedId}::uuid
  `;
  assert.equal(await respond(ownerC, tamperedId, "tampered", true), "unavailable");

  const blockedId = await createInvitation(ownerA, groupId, ownerE, "blocked");
  await sql`
    insert into user_blocks (blocker_id, blocked_id)
    values (${ownerE}, ${ownerA})
  `;
  const blocked = await sql<{ status: string; token_digest: string | null }[]>`
    select status, token_digest
    from research_group_invitations
    where id = ${blockedId}::uuid
  `;
  assert.deepEqual([...blocked], [{ status: "revoked", token_digest: null }]);

  await sql`delete from user_blocks where blocker_id = ${ownerE} and blocked_id = ${ownerA}`;
  const policyId = await createInvitation(ownerA, groupId, ownerE, "policy");
  await sql`
    update collaboration_identities
    set group_invite_policy = 'nobody'
    where owner_id = ${ownerE}
  `;
  assert.equal(await respond(ownerE, policyId, "policy", true), "unavailable");
});

run("supports decline, inviter cancellation, and current-manager revocation", async () => {
  assert.ok(sql);
  const groupId = await createGroup(ownerA, [{ id: ownerE, role: "admin" }]);
  const declineId = await createInvitation(ownerA, groupId, ownerC, "decline");
  assert.equal(await respond(ownerC, declineId, "decline", false), "declined");
  assert.equal(await respond(ownerC, declineId, "decline", false), "declined");
  await assert.rejects(
    sql`
      select cancel_research_group_invitation(
        ${ownerA},
        ${declineId}::uuid
      )
    `,
    /invitation_unavailable/,
  );

  const cancelId = await createInvitation(ownerA, groupId, ownerC, "cancel");
  await sql`
    select cancel_research_group_invitation(${ownerA}, ${cancelId}::uuid)
  `;
  await sql`
    select cancel_research_group_invitation(${ownerA}, ${cancelId}::uuid)
  `;

  const revokeId = await createInvitation(ownerE, groupId, ownerC, "revoke");
  await sql`
    select revoke_research_group_invitation(${ownerA}, ${revokeId}::uuid)
  `;
  const states = await sql<{ id: string; status: string }[]>`
    select id, status
    from research_group_invitations
    where id in (${cancelId}::uuid, ${revokeId}::uuid)
    order by id
  `;
  assert.deepEqual(
    new Map(states.map((state) => [state.id, state.status])),
    new Map([[cancelId, "cancelled"], [revokeId, "revoked"]]),
  );
});

run("enforces owner/admin role changes, removal hierarchy, leave, and immediate RLS loss", async () => {
  assert.ok(sql);
  const groupId = await createGroup(ownerA, [
    { id: ownerB, role: "admin" },
    { id: ownerC, role: "member" },
    { id: ownerD, role: "admin" },
  ]);

  await sql`
    select set_research_group_member_role(
      ${ownerA},
      ${groupId}::uuid,
      ${publicIds[ownerC]}::uuid,
      'admin'
    )
  `;
  await assert.rejects(
    sql`
      select remove_research_group_member(
        ${ownerB},
        ${groupId}::uuid,
        ${publicIds[ownerC]}::uuid
      )
    `,
    /research_group_unavailable/,
  );
  await sql`
    select set_research_group_member_role(
      ${ownerA},
      ${groupId}::uuid,
      ${publicIds[ownerC]}::uuid,
      'member'
    )
  `;
  await sql`
    select remove_research_group_member(
      ${ownerB},
      ${groupId}::uuid,
      ${publicIds[ownerC]}::uuid
    )
  `;
  const visibleAfterRemoval = await asUser(
    ownerC,
    (transaction) =>
      transaction`select id from research_groups where id = ${groupId}::uuid`,
  );
  assert.equal(visibleAfterRemoval.length, 0);

  await sql`select leave_research_group(${ownerD}, ${groupId}::uuid)`;
  await assert.rejects(
    sql`select leave_research_group(${ownerA}, ${groupId}::uuid)`,
    /research_group_unavailable/,
  );
});

run("revokes pending invitations during account deletion and keeps APIs service-role-only", async () => {
  assert.ok(sql);
  const groupId = await createGroup();
  const invitationId = await createInvitation(ownerA, groupId, ownerC, "delete");

  await sql`select * from handle_clerk_user_deleted(${ownerC})`;
  const invitation = await sql<{ status: string; token_digest: string | null }[]>`
    select status, token_digest
    from research_group_invitations
    where id = ${invitationId}::uuid
  `;
  assert.deepEqual([...invitation], [{ status: "revoked", token_digest: null }]);

  const privileges = await sql<{
    service_role_execute: boolean;
    authenticated_execute: boolean;
    in_app_service_role_execute: boolean;
    in_app_authenticated_execute: boolean;
    authenticated_table_select: boolean;
  }[]>`
    select
      has_function_privilege(
        'service_role',
        'create_research_group_invitation(text,uuid,uuid,text)',
        'execute'
      ) as service_role_execute,
      has_function_privilege(
        'authenticated',
        'create_research_group_invitation(text,uuid,uuid,text)',
        'execute'
      ) as authenticated_execute,
      has_function_privilege(
        'service_role',
        'respond_research_group_invitation_in_app(text,uuid,boolean)',
        'execute'
      ) as in_app_service_role_execute,
      has_function_privilege(
        'authenticated',
        'respond_research_group_invitation_in_app(text,uuid,boolean)',
        'execute'
      ) as in_app_authenticated_execute,
      has_table_privilege(
        'authenticated',
        'research_group_invitations',
        'select'
      ) as authenticated_table_select
  `;
  assert.deepEqual([...privileges], [{
    service_role_execute: true,
    authenticated_execute: false,
    in_app_service_role_execute: true,
    in_app_authenticated_execute: false,
    authenticated_table_select: false,
  }]);
});
