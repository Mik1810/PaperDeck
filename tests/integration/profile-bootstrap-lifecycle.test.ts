import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import postgres, { type Sql } from "postgres";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.PAPERDECK_RUN_PROFILE_BOOTSTRAP_INTEGRATION === "true";
const run = databaseUrl && enabled ? test : test.skip;
const lifecycleOwnerId = `profile-lifecycle-${randomUUID()}`;
const fallbackOwnerId = `profile-fallback-${randomUUID()}`;
const paperId = randomUUID();
let sql: Sql | undefined;
let ensureUserProfile: typeof import("../../src/lib/repositories/user-data")["ensureUserProfile"];
let withOwnerProfileFallback: typeof import("../../src/lib/repositories/user-data")["withOwnerProfileFallback"];

async function cleanup() {
  assert.ok(sql);
  await sql`
    delete from profiles
    where owner_id in (${lifecycleOwnerId}, ${fallbackOwnerId})
  `;
  await sql`delete from papers where id = ${paperId}::uuid`;
}

before(async () => {
  if (!databaseUrl || !enabled) return;
  sql = postgres(databaseUrl, { max: 4, prepare: false });
  ({
    ensureUserProfile,
    withOwnerProfileFallback,
  } = await import("../../src/lib/repositories/user-data"));
  await cleanup();
  await sql`
    insert into papers (
      id, title, abstract, year, source, url, access
    ) values (
      ${paperId}::uuid,
      'Profile fallback fixture paper',
      'Disposable local mutation fixture.',
      2026,
      'manual',
      'https://example.invalid/profile-fallback',
      'open'
    )
  `;
});

after(async () => {
  if (!sql) return;
  try {
    await cleanup();
  } finally {
    await sql.end();
  }
});

run("explicit onboarding lifecycle provisions profile and Read later", async () => {
  assert.ok(sql);
  await ensureUserProfile({
    ownerId: lifecycleOwnerId,
    displayName: "Lifecycle fixture",
    imageUrl: null,
    primaryEmail: null,
    sourceUpdatedAt: 0,
  });

  const [state] = await sql<{ playlists: number; profiles: number }[]>`
    select
      (select count(*)::integer from profiles where owner_id = ${lifecycleOwnerId}) as profiles,
      (
        select count(*)::integer
        from playlists
        where owner_id = ${lifecycleOwnerId}
          and name = 'Read later'
          and is_default
      ) as playlists
  `;
  assert.deepEqual(state, { playlists: 1, profiles: 1 });
});

run("a missing-profile mutation retries once without eager playlist provisioning", async () => {
  assert.ok(sql);
  await withOwnerProfileFallback(fallbackOwnerId, async () => {
    await sql!`
      insert into user_paper_interactions (
        owner_id, paper_id, action, context
      ) values (
        ${fallbackOwnerId},
        ${paperId}::uuid,
        'dismiss',
        'profile-fallback-test'
      )
    `;
  });

  const [state] = await sql<{
    interactions: number;
    playlists: number;
    profiles: number;
  }[]>`
    select
      (select count(*)::integer from profiles where owner_id = ${fallbackOwnerId}) as profiles,
      (select count(*)::integer from playlists where owner_id = ${fallbackOwnerId}) as playlists,
      (
        select count(*)::integer
        from user_paper_interactions
        where owner_id = ${fallbackOwnerId}
          and paper_id = ${paperId}::uuid
          and action = 'dismiss'
      ) as interactions
  `;
  assert.deepEqual(state, { interactions: 1, playlists: 0, profiles: 1 });
});
