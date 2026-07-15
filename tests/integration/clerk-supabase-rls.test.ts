import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import postgres, { type Sql, type TransactionSql } from "postgres";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
const run = databaseUrl ? test : test.skip;
const ownerA = `rls-test-a-${randomUUID()}`;
const ownerB = `rls-test-b-${randomUUID()}`;
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
let sql: Sql | undefined;

async function asRole<T>(
  role: "anon" | "authenticated",
  claims: Record<string, string>,
  task: (transaction: TransactionSql) => Promise<T>,
) {
  assert.ok(sql);

  return sql.begin(async (transaction) => {
    await transaction`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
    await transaction.unsafe(`set local role ${role}`);
    return task(transaction);
  });
}

before(async () => {
  if (!databaseUrl) return;

  sql = postgres(databaseUrl, { max: 1 });
  await sql`
    insert into profiles (owner_id, display_name)
    values (${ownerA}, 'RLS owner A'), (${ownerB}, 'RLS owner B')
  `;
  await sql`
    insert into collaboration_identities (owner_id, email_lookup_hash)
    values (${ownerA}, ${hashA}), (${ownerB}, ${hashB})
  `;
});

after(async () => {
  if (!sql) return;

  await sql`delete from profiles where owner_id in (${ownerA}, ${ownerB})`;
  await sql.end();
});

run("authenticated users can read only their own profile", async () => {
  const rows = await asRole("authenticated", { sub: ownerA }, (transaction) =>
    transaction<{ owner_id: string }[]>`
      select owner_id
      from profiles
      where owner_id in (${ownerA}, ${ownerB})
      order by owner_id
    `,
  );

  assert.deepEqual([...rows], [{ owner_id: ownerA }]);
});

run("authenticated users cannot update or delete another profile", async () => {
  await asRole("authenticated", { sub: ownerA }, async (transaction) => {
    const updated = await transaction<{ owner_id: string }[]>`
      update profiles
      set display_name = 'tampered'
      where owner_id = ${ownerB}
      returning owner_id
    `;
    const deleted = await transaction<{ owner_id: string }[]>`
      delete from profiles
      where owner_id = ${ownerB}
      returning owner_id
    `;

    assert.equal(updated.length, 0);
    assert.equal(deleted.length, 0);
  });

  const ownerBRows = await sql!<{ display_name: string | null }[]>`
      select display_name from profiles where owner_id = ${ownerB}
    `;
  assert.deepEqual([...ownerBRows], [{ display_name: "RLS owner B" }]);
});

run("authenticated users can update their own profile", async () => {
  const updated = await asRole(
    "authenticated",
    { sub: ownerA },
    (transaction) => transaction<{ owner_id: string }[]>`
      update profiles
      set display_name = 'RLS owner A updated'
      where owner_id = ${ownerA}
      returning owner_id
    `,
  );

  assert.deepEqual([...updated], [{ owner_id: ownerA }]);
});

run("missing or unrelated claims cannot read seeded profiles", async () => {
  const [anonymousRows, unrelatedRows] = await Promise.all([
    asRole("anon", {}, (transaction) => transaction<{ owner_id: string }[]>`
      select owner_id from profiles where owner_id in (${ownerA}, ${ownerB})
    `),
    asRole(
      "authenticated",
      { sub: `rls-test-outsider-${randomUUID()}` },
      (transaction) => transaction<{ owner_id: string }[]>`
        select owner_id from profiles where owner_id in (${ownerA}, ${ownerB})
      `,
    ),
  ]);

  assert.deepEqual([...anonymousRows], []);
  assert.deepEqual([...unrelatedRows], []);
});

run("authenticated users cannot insert a profile for another owner", async () => {
  const foreignOwner = `rls-test-foreign-${randomUUID()}`;

  await assert.rejects(
    asRole("authenticated", { sub: ownerA }, (transaction) => transaction`
      insert into profiles (owner_id, display_name)
      values (${foreignOwner}, 'Foreign profile')
    `),
    /row-level security|policy/i,
  );
});

run("collaboration identities expose only the current owner's private row", async () => {
  const rows = await asRole("authenticated", { sub: ownerA }, (transaction) =>
    transaction<{ owner_id: string }[]>`
      select owner_id from collaboration_identities order by owner_id
    `,
  );

  assert.deepEqual([...rows], [{ owner_id: ownerA }]);
});

run("collaboration public ids remain immutable", async () => {
  await assert.rejects(
    asRole("authenticated", { sub: ownerA }, (transaction) => transaction`
      update collaboration_identities
      set public_id = ${randomUUID()}
      where owner_id = ${ownerA}
    `),
    /collaboration_public_id_is_immutable/,
  );
});

run("exact-email discovery returns only the public profile projection", async () => {
  const rows = await asRole("authenticated", { sub: ownerA }, (transaction) =>
    transaction<{
      public_id: string;
      display_name: string;
      image_url: string | null;
    }[]>`select * from find_collaboration_profile(${hashB})`,
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].display_name, "RLS owner B");
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    "display_name",
    "image_url",
    "public_id",
    "relationship_status",
    "request_id",
  ]);
});

run("undiscoverable and missing profiles have the same empty result", async () => {
  await sql!`
    update collaboration_identities
    set discoverable_by_email = false
    where owner_id = ${ownerB}
  `;

  const [hidden, missing] = await Promise.all([
    asRole("authenticated", { sub: ownerA }, (transaction) =>
      transaction`select * from find_collaboration_profile(${hashB})`,
    ),
    asRole("authenticated", { sub: ownerA }, (transaction) =>
      transaction`select * from find_collaboration_profile(${"c".repeat(64)})`,
    ),
  ]);

  assert.deepEqual([...hidden], []);
  assert.deepEqual([...missing], []);
});

run("anonymous callers cannot execute collaboration discovery", async () => {
  await assert.rejects(
    asRole("anon", {}, (transaction) =>
      transaction`select * from find_collaboration_profile(${hashB})`,
    ),
    /permission denied/i,
  );
});

run("exact-email discovery is limited to ten attempts per minute", async () => {
  await sql!`delete from collaboration_search_limits where requester_id = ${ownerA}`;

  await assert.rejects(
    asRole("authenticated", { sub: ownerA }, async (transaction) => {
      for (let attempt = 0; attempt < 11; attempt += 1) {
        await transaction`select * from find_collaboration_profile(${hashB})`;
      }
    }),
    /rate_limit_exceeded/,
  );
});
