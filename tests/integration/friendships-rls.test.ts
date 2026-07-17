import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import postgres, { type Sql, type TransactionSql } from "postgres";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
const run = databaseUrl ? test : test.skip;
const ownerA = `friend-test-a-${randomUUID()}`;
const ownerB = `friend-test-b-${randomUUID()}`;
const ownerC = `friend-test-c-${randomUUID()}`;
const owners = [ownerA, ownerB, ownerC];
const hashFor = (owner: string) =>
  createHash("sha256").update(owner).digest("hex");
let sql: Sql | undefined;
let publicA = "";
let publicB = "";

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

before(async () => {
  if (!databaseUrl) return;
  sql = postgres(databaseUrl, { max: 1 });
  await sql`
    insert into profiles (owner_id, display_name)
    values (${ownerA}, 'Friend A'), (${ownerB}, 'Friend B'), (${ownerC}, 'Friend C')
  `;
  const identities = await sql<{ owner_id: string; public_id: string }[]>`
    insert into collaboration_identities (owner_id, email_lookup_hash)
    values
      (${ownerA}, ${hashFor(ownerA)}),
      (${ownerB}, ${hashFor(ownerB)}),
      (${ownerC}, ${hashFor(ownerC)})
    returning owner_id, public_id
  `;
  publicA = identities.find((row) => row.owner_id === ownerA)!.public_id;
  publicB = identities.find((row) => row.owner_id === ownerB)!.public_id;
});

beforeEach(async () => {
  if (!sql) return;
  await sql`delete from user_blocks where blocker_id in ${sql(owners)} or blocked_id in ${sql(owners)}`;
  await sql`delete from friendships where user_low_id in ${sql(owners)} or user_high_id in ${sql(owners)}`;
  await sql`delete from friend_requests where requester_id in ${sql(owners)} or recipient_id in ${sql(owners)}`;
});

after(async () => {
  if (!sql) return;
  await sql`delete from profiles where owner_id in ${sql(owners)}`;
  await sql.end();
});

run("duplicate sends are idempotent and a crossed request accepts friendship", async () => {
  const first = await asUser(ownerA, (transaction) => transaction<{
    relationship_status: string;
    request_id: string;
  }[]>`select * from send_friend_request(${publicB}::uuid)`);
  const duplicate = await asUser(ownerA, (transaction) => transaction<{
    relationship_status: string;
    request_id: string;
  }[]>`select * from send_friend_request(${publicB}::uuid)`);

  assert.equal(first[0].relationship_status, "outgoing_pending");
  assert.equal(duplicate[0].request_id, first[0].request_id);

  const recipientConnections = await asUser(ownerB, (transaction) => transaction<{
    relationship_status: string;
    request_id: string;
  }[]>`select * from list_collaboration_connections()`);
  assert.equal(recipientConnections[0].relationship_status, "incoming_pending");
  assert.equal(recipientConnections[0].request_id, first[0].request_id);

  const crossed = await asUser(ownerB, (transaction) => transaction<{
    relationship_status: string;
  }[]>`select * from send_friend_request(${publicA}::uuid)`);
  assert.equal(crossed[0].relationship_status, "friends");

  const friendships = await sql!`select * from friendships where user_low_id = ${[ownerA, ownerB].sort()[0]} and user_high_id = ${[ownerA, ownerB].sort()[1]}`;
  assert.equal(friendships.length, 1);
});

run("decline applies a requester-specific 30-day cooldown", async () => {
  const request = await asUser(ownerA, (transaction) => transaction<{
    request_id: string;
  }[]>`select * from send_friend_request(${publicB}::uuid)`);
  await asUser(ownerB, (transaction) => transaction`
    select respond_friend_request(${request[0].request_id}::uuid, false)
  `);

  await assert.rejects(
    asUser(ownerA, (transaction) =>
      transaction`select * from send_friend_request(${publicB}::uuid)`,
    ),
    /friend_request_cooldown/,
  );

  const reverse = await asUser(ownerB, (transaction) => transaction<{
    relationship_status: string;
  }[]>`select * from send_friend_request(${publicA}::uuid)`);
  assert.equal(reverse[0].relationship_status, "outgoing_pending");
});

run("only the recipient can respond to a pending request", async () => {
  const request = await asUser(ownerA, (transaction) => transaction<{
    request_id: string;
  }[]>`select * from send_friend_request(${publicB}::uuid)`);

  await assert.rejects(
    asUser(ownerC, (transaction) => transaction`
      select respond_friend_request(${request[0].request_id}::uuid, true)
    `),
    /request_unavailable/,
  );
});

run("cancel, accept, and unfriend transitions are idempotent", async () => {
  const cancelled = await asUser(ownerA, (transaction) => transaction<{
    request_id: string;
  }[]>`select * from send_friend_request(${publicB}::uuid)`);
  await asUser(ownerA, (transaction) => transaction`
    select cancel_friend_request(${cancelled[0].request_id}::uuid)
  `);
  await asUser(ownerA, (transaction) => transaction`
    select cancel_friend_request(${cancelled[0].request_id}::uuid)
  `);

  const accepted = await asUser(ownerA, (transaction) => transaction<{
    request_id: string;
  }[]>`select * from send_friend_request(${publicB}::uuid)`);
  await asUser(ownerB, (transaction) => transaction`
    select respond_friend_request(${accepted[0].request_id}::uuid, true)
  `);
  const repeated = await asUser(ownerB, (transaction) => transaction<{
    status: string;
  }[]>`select respond_friend_request(${accepted[0].request_id}::uuid, true) as status`);
  assert.equal(repeated[0].status, "friends");

  await asUser(ownerA, (transaction) =>
    transaction`select unfriend_profile(${publicB}::uuid)`,
  );
  await asUser(ownerA, (transaction) =>
    transaction`select unfriend_profile(${publicB}::uuid)`,
  );
  const rows = await sql!`select * from friendships where user_low_id = ${[ownerA, ownerB].sort()[0]} and user_high_id = ${[ownerA, ownerB].sort()[1]}`;
  assert.deepEqual([...rows], []);
});

run("new friend requests are limited to ten per rolling day", async () => {
  await assert.rejects(
    asUser(ownerA, async (transaction) => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const rows = await transaction<{ request_id: string }[]>`
          select * from send_friend_request(${publicB}::uuid)
        `;
        await transaction`
          select cancel_friend_request(${rows[0].request_id}::uuid)
        `;
      }
      await transaction`select * from send_friend_request(${publicB}::uuid)`;
    }),
    /friend_request_rate_limited/,
  );
});

run("blocking cancels relationships and hides discovery in both directions", async () => {
  await asUser(ownerA, (transaction) =>
    transaction`select * from send_friend_request(${publicB}::uuid)`,
  );
  await asUser(ownerA, (transaction) =>
    transaction`select block_profile(${publicB}::uuid)`,
  );

  const [viewA, viewB] = await Promise.all([
    asUser(ownerA, (transaction) => transaction`
      select * from find_collaboration_profile(${hashFor(ownerB)})
    `),
    asUser(ownerB, (transaction) => transaction`
      select * from find_collaboration_profile(${hashFor(ownerA)})
    `),
  ]);
  assert.deepEqual([...viewA], []);
  assert.deepEqual([...viewB], []);

  const listA = await asUser(ownerA, (transaction) => transaction<{
    relationship_status: string;
  }[]>`select * from list_collaboration_connections()`);
  const listB = await asUser(ownerB, (transaction) =>
    transaction`select * from list_collaboration_connections()`,
  );
  assert.equal(listA[0].relationship_status, "blocked");
  assert.deepEqual([...listB], []);

  await assert.rejects(
    asUser(ownerB, (transaction) =>
      transaction`select * from send_friend_request(${publicA}::uuid)`,
    ),
    /profile_unavailable/,
  );

  await asUser(ownerA, (transaction) =>
    transaction`select unblock_profile(${publicB}::uuid)`,
  );
  const afterUnblock = await asUser(ownerB, (transaction) => transaction<{
    relationship_status: string;
  }[]>`select * from send_friend_request(${publicA}::uuid)`);
  assert.equal(afterUnblock[0].relationship_status, "outgoing_pending");
});

run("direct writes remain denied and friendship has no ranking side effects", async () => {
  await assert.rejects(
    asUser(ownerA, (transaction) => transaction`
      insert into friendships (user_low_id, user_high_id)
      values (${[ownerA, ownerB].sort()[0]}, ${[ownerA, ownerB].sort()[1]})
    `),
    /row-level security|policy/i,
  );

  const before = await sql!<{ source: string; count: string }[]>`
    select 'interactions' as source, count(*)::text from user_paper_interactions where owner_id in ${sql!(owners)}
    union all select 'impressions', count(*)::text from recommendation_impressions where owner_id in ${sql!(owners)}
    union all select 'recommendations', count(*)::text from recommendations where owner_id in ${sql!(owners)}
    union all select 'profile_embeddings', count(*)::text from user_profile_embeddings where owner_id in ${sql!(owners)}
  `;
  await asUser(ownerA, (transaction) =>
    transaction`select * from send_friend_request(${publicB}::uuid)`,
  );
  const afterRows = await sql!<{ source: string; count: string }[]>`
    select 'interactions' as source, count(*)::text from user_paper_interactions where owner_id in ${sql!(owners)}
    union all select 'impressions', count(*)::text from recommendation_impressions where owner_id in ${sql!(owners)}
    union all select 'recommendations', count(*)::text from recommendations where owner_id in ${sql!(owners)}
    union all select 'profile_embeddings', count(*)::text from user_profile_embeddings where owner_id in ${sql!(owners)}
  `;
  assert.deepEqual([...afterRows], [...before]);
});

run("a requester must have a public collaboration identity", async () => {
  const ownerWithoutIdentity = `friend-test-no-identity-${randomUUID()}`;
  await sql!`
    insert into profiles (owner_id, display_name)
    values (${ownerWithoutIdentity}, 'No identity')
  `;
  try {
    await assert.rejects(
      asUser(ownerWithoutIdentity, (transaction) =>
        transaction`select * from send_friend_request(${publicA}::uuid)`,
      ),
      /public_profile_required/,
    );
  } finally {
    await sql!`delete from profiles where owner_id = ${ownerWithoutIdentity}`;
  }
});
