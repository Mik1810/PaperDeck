import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import postgres, { type Sql, type TransactionSql } from "postgres";

loadEnvConfig(process.cwd());

const enabled = process.env.PAPERDECK_RUN_GROUP_PAPERS_INTEGRATION === "true";
const databaseUrl = process.env.DATABASE_URL;
const isolatedHost = process.env.PAPERDECK_TEST_PGHOST;
const isolatedUser = process.env.PAPERDECK_TEST_PGUSER;
const run = enabled && databaseUrl ? test : test.skip;
const owner = `group-paper-owner-${randomUUID()}`;
const admin = `group-paper-admin-${randomUUID()}`;
const member = `group-paper-member-${randomUUID()}`;
const memberTwo = `group-paper-member-two-${randomUUID()}`;
const outsider = `group-paper-outsider-${randomUUID()}`;
const actors = [owner, admin, member, memberTwo, outsider];
let sql: Sql | undefined;
let groupId = "";
let paperIds: string[] = [];

async function asUser<T>(
  actorId: string,
  task: (transaction: TransactionSql) => Promise<T>,
) {
  assert.ok(sql);
  return sql.begin(async (transaction) => {
    await transaction`select set_config('request.jwt.claims', ${JSON.stringify({ sub: actorId })}, true)`;
    await transaction.unsafe("set local role authenticated");
    return task(transaction);
  });
}

async function add(actorId: string, paperId: string) {
  assert.ok(sql);
  return sql<{ changed: boolean; activity_id: string | null }[]>`
    select * from add_research_group_paper(
      ${actorId},
      ${groupId}::uuid,
      ${paperId}::uuid
    )
  `;
}

async function remove(actorId: string, paperId: string) {
  assert.ok(sql);
  return sql<{ changed: boolean; activity_id: string | null }[]>`
    select * from remove_research_group_paper(
      ${actorId},
      ${groupId}::uuid,
      ${paperId}::uuid
    )
  `;
}

before(async () => {
  if (!enabled || !databaseUrl) return;

  sql = isolatedHost
    ? postgres({
        host: isolatedHost,
        database: "postgres",
        username: isolatedUser,
        max: 6,
      })
    : postgres(databaseUrl, { max: 6, prepare: false });

  await sql`
    update private.research_group_runtime_settings
    set reads_enabled = true, writes_enabled = true
    where singleton
  `;
  await sql`
    insert into profiles (owner_id, display_name)
    values
      (${owner}, 'Owner'),
      (${admin}, 'Admin'),
      (${member}, 'Member'),
      (${memberTwo}, 'Member Two'),
      (${outsider}, 'Outsider')
  `;
  const groups = await sql<{ id: string }[]>`
    insert into research_groups (name)
    values ('Shared papers integration group')
    returning id
  `;
  groupId = groups[0].id;
  await sql`
    insert into research_group_members (group_id, member_id, role)
    values
      (${groupId}::uuid, ${owner}, 'owner'),
      (${groupId}::uuid, ${admin}, 'admin'),
      (${groupId}::uuid, ${member}, 'member'),
      (${groupId}::uuid, ${memberTwo}, 'member')
  `;
  const paperRows = await sql<{ id: string }[]>`
    insert into papers (title, url)
    values
      ('Shared paper one', 'https://example.test/paper-1'),
      ('Shared paper two', 'https://example.test/paper-2'),
      ('Shared paper three', 'https://example.test/paper-3'),
      ('Shared paper four', 'https://example.test/paper-4')
    returning id
  `;
  paperIds = paperRows.map((row) => row.id);
});

beforeEach(async () => {
  if (!sql) return;
  await sql`delete from notifications where group_id = ${groupId}::uuid`;
  await sql`delete from research_group_paper_activity where group_id = ${groupId}::uuid`;
  await sql`delete from research_group_paper_items where group_id = ${groupId}::uuid`;
  await sql`
    update research_group_members
    set
      revoked_at = null,
      paper_notification_preference = 'all',
      updated_at = now()
    where group_id = ${groupId}::uuid
  `;
  await sql`
    update private.research_group_runtime_settings
    set reads_enabled = true, writes_enabled = true
    where singleton
  `;
});

after(async () => {
  if (!sql) return;
  await sql`delete from research_groups where id = ${groupId}::uuid`;
  await sql`delete from papers where id in ${sql(paperIds)}`;
  await sql`delete from profiles where owner_id in ${sql(actors)}`;
  await sql`
    update private.research_group_runtime_settings
    set reads_enabled = false, writes_enabled = false
    where singleton
  `;
  await sql.end();
});

run("duplicate adds are idempotent, aggregated, and ranking-isolated", async () => {
  assert.ok(sql);
  await sql`
    update research_group_members
    set paper_notification_preference = case
      when member_id = ${admin} then 'important_only'::research_group_paper_notification_preference
      when member_id = ${member} then 'muted'::research_group_paper_notification_preference
      else paper_notification_preference
    end
    where group_id = ${groupId}::uuid
  `;

  const duplicateResults = await Promise.all([
    add(owner, paperIds[0]),
    add(owner, paperIds[0]),
  ]);
  assert.deepEqual(
    duplicateResults.map((rows) => rows[0].changed).sort(),
    [false, true],
  );
  await add(owner, paperIds[1]);

  const items = await sql<{ paper_id: string }[]>`
    select paper_id
    from research_group_paper_items
    where group_id = ${groupId}::uuid
  `;
  assert.equal(items.length, 2);

  const activity = await sql<{ event_count: number }[]>`
    select event_count
    from research_group_paper_activity
    where group_id = ${groupId}::uuid and kind = 'papers_added'
  `;
  assert.deepEqual([...activity], [{ event_count: 2 }]);

  const recipients = await sql<{ recipient_id: string }[]>`
    select recipient_id
    from notifications
    where group_id = ${groupId}::uuid and type = 'group_papers_added'
  `;
  assert.deepEqual([...recipients], [{ recipient_id: memberTwo }]);

  const privateWrites = await sql<{ count: number }[]>`
    select (
      (select count(*) from favorites where paper_id in ${sql(paperIds)})
      + (select count(*) from playlist_items where paper_id in ${sql(paperIds)})
      + (select count(*) from user_paper_interactions where paper_id in ${sql(paperIds)})
      + (select count(*) from recommendations where paper_id in ${sql(paperIds)})
    )::integer as count
  `;
  assert.equal(privateWrites[0].count, 0);
});

run("members remove only their own additions while admins moderate", async () => {
  assert.ok(sql);
  await add(member, paperIds[0]);

  await assert.rejects(
    () => remove(memberTwo, paperIds[0]),
    /research_group_unavailable/,
  );
  assert.equal((await remove(member, paperIds[0]))[0].changed, true);
  assert.equal((await remove(member, paperIds[0]))[0].changed, false);

  await add(member, paperIds[1]);
  assert.equal((await remove(admin, paperIds[1]))[0].changed, true);
  const notifications = await sql<{ recipient_id: string }[]>`
    select recipient_id
    from notifications
    where type = 'group_paper_removed'
  `;
  assert.deepEqual([...notifications], [{ recipient_id: member }]);
});

run("removal notifications respect important-only and muted preferences", async () => {
  assert.ok(sql);
  await sql`
    select set_research_group_paper_notification_preference(
      ${member},
      ${groupId}::uuid,
      'important_only'
    )
  `;
  await add(member, paperIds[0]);
  await remove(owner, paperIds[0]);
  assert.equal((await sql`select id from notifications where recipient_id = ${member}`).length, 1);

  await sql`delete from notifications where group_id = ${groupId}::uuid`;
  await sql`
    select set_research_group_paper_notification_preference(
      ${member},
      ${groupId}::uuid,
      'muted'
    )
  `;
  await add(member, paperIds[1]);
  await remove(owner, paperIds[1]);
  assert.equal((await sql`select id from notifications where recipient_id = ${member}`).length, 0);
});

run("RLS hides shared papers from outsiders and revoked members", async () => {
  assert.ok(sql);
  await add(owner, paperIds[0]);

  const ownerRows = await asUser(owner, (transaction) =>
    transaction`select paper_id from research_group_paper_items`,
  );
  const outsiderRows = await asUser(outsider, (transaction) =>
    transaction`select paper_id from research_group_paper_items`,
  );
  assert.equal(ownerRows.length, 1);
  assert.equal(outsiderRows.length, 0);

  await sql`
    update research_group_members
    set revoked_at = now()
    where group_id = ${groupId}::uuid and member_id = ${member}
  `;
  const revokedRows = await asUser(member, (transaction) =>
    transaction`select paper_id from research_group_paper_items`,
  );
  assert.equal(revokedRows.length, 0);
  await assert.rejects(
    () => add(member, paperIds[1]),
    /research_group_unavailable/,
  );
});

run("account closure preserves the paper but anonymizes its contributor", async () => {
  assert.ok(sql);
  const departingMember = `group-paper-departing-${randomUUID()}`;
  await sql`
    insert into profiles (owner_id, display_name)
    values (${departingMember}, 'Departing member')
  `;
  await sql`
    insert into research_group_members (group_id, member_id, role)
    values (${groupId}::uuid, ${departingMember}, 'member')
  `;

  await add(departingMember, paperIds[0]);
  await sql`delete from profiles where owner_id = ${departingMember}`;

  const items = await sql<{ added_by: string | null }[]>`
    select added_by
    from research_group_paper_items
    where group_id = ${groupId}::uuid and paper_id = ${paperIds[0]}::uuid
  `;
  const activity = await sql<{ actor_id: string | null }[]>`
    select actor_id
    from research_group_paper_activity
    where group_id = ${groupId}::uuid and representative_paper_id = ${paperIds[0]}::uuid
  `;
  assert.deepEqual([...items], [{ added_by: null }]);
  assert.deepEqual([...activity], [{ actor_id: null }]);
});

run("write kill switch blocks mutations without changing current rows", async () => {
  assert.ok(sql);
  await add(owner, paperIds[0]);
  await sql`
    update private.research_group_runtime_settings
    set writes_enabled = false
    where singleton
  `;
  await assert.rejects(
    () => add(owner, paperIds[1]),
    /research_group_unavailable/,
  );
  assert.equal(
    (await sql`select paper_id from research_group_paper_items where group_id = ${groupId}::uuid`).length,
    1,
  );
});

run("API grants are read-only and mutations remain service-role-only", async () => {
  assert.ok(sql);
  const rows = await sql<{
    authenticated_select: boolean;
    authenticated_insert: boolean;
    authenticated_add_execute: boolean;
    service_add_execute: boolean;
    add_security_definer: boolean;
    add_config: string[] | null;
  }[]>`
    select
      has_table_privilege('authenticated', 'research_group_paper_items', 'SELECT')
        as authenticated_select,
      has_table_privilege('authenticated', 'research_group_paper_items', 'INSERT')
        as authenticated_insert,
      has_function_privilege(
        'authenticated',
        'add_research_group_paper(text,uuid,uuid)',
        'EXECUTE'
      ) as authenticated_add_execute,
      has_function_privilege(
        'service_role',
        'add_research_group_paper(text,uuid,uuid)',
        'EXECUTE'
      ) as service_add_execute,
      procedure.prosecdef as add_security_definer,
      procedure.proconfig as add_config
    from pg_proc as procedure
    where procedure.oid = 'add_research_group_paper(text,uuid,uuid)'::regprocedure
  `;

  assert.deepEqual([...rows], [{
    authenticated_select: true,
    authenticated_insert: false,
    authenticated_add_execute: false,
    service_add_execute: true,
    add_security_definer: false,
    add_config: ["search_path=pg_catalog, public, private"],
  }]);
});

run("expired activity is purged in bounded batches with derived notifications", async () => {
  assert.ok(sql);
  await add(owner, paperIds[0]);
  await sql`
    update research_group_paper_activity
    set
      first_occurred_at = now() - interval '91 days',
      last_occurred_at = now() - interval '91 days',
      expires_at = now() - interval '1 day'
    where group_id = ${groupId}::uuid
  `;

  const purged = await sql<{ count: number }[]>`
    select private.purge_expired_group_paper_activity(100) as count
  `;
  assert.equal(purged[0].count, 1);
  assert.equal((await sql`select id from research_group_paper_activity`).length, 0);
  assert.equal((await sql`select id from notifications where group_id = ${groupId}::uuid`).length, 0);
});
