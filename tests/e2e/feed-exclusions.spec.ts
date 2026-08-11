import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const devAuthEnabled = process.env.PAPERDECK_E2E_DEV_AUTH !== "false";
const hasDatabase = Boolean(process.env.DATABASE_URL);
const ownerId =
  process.env.PAPERDECK_E2E_OWNER_ID ??
  process.env.PAPERDECK_DEV_OWNER_ID ??
  "playwright-user";

function database() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for feed exclusion tests");
  }

  return postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
}

test.beforeEach(async () => {
  test.skip(!devAuthEnabled, "Requires dev auth.");
  test.skip(!hasDatabase, "Requires DATABASE_URL.");

  const sql = database();
  try {
    await sql`delete from profiles where owner_id = ${ownerId}`;
  } finally {
    await sql.end();
  }
});

test("durable opens survive the ranking window while playlist state remains reversible", async ({
  page,
}) => {
  const sql = database();
  let durablePaperId = "";
  let playlistPaperId = "";
  let expectedVisiblePaperId = "";
  let playlistId = "";

  try {
    const papers = await sql<{ id: string }[]>`
      select id
      from papers
      order by published_at desc nulls last, id
      limit 12
    `;
    expect(papers).toHaveLength(12);
    durablePaperId = papers[0].id;
    playlistPaperId = papers[1].id;
    expectedVisiblePaperId = papers[2].id;

    await sql`
      insert into profiles (owner_id, onboarding_completed_at)
      values (${ownerId}, now())
    `;
    const [playlist] = await sql<{ id: string }[]>`
      insert into playlists (owner_id, name)
      values (${ownerId}, 'Durable exclusion fixture')
      returning id
    `;
    playlistId = playlist.id;
    await sql`
      insert into playlist_items (playlist_id, paper_id)
      values (${playlistId}, ${playlistPaperId}::uuid)
    `;

    await sql`
      insert into user_paper_interactions (
        owner_id,
        paper_id,
        action,
        context,
        created_at
      ) values (
        ${ownerId},
        ${durablePaperId}::uuid,
        'open_detail',
        'feed',
        now() - interval '1 hour'
      )
    `;
    await sql`
      insert into user_paper_interactions (
        owner_id,
        paper_id,
        action,
        context,
        created_at
      ) values (
        ${ownerId},
        ${durablePaperId}::uuid,
        'not_interested',
        'feed',
        now() - interval '2 hours'
      )
    `;
    await sql`
      insert into user_paper_interactions (
        owner_id,
        paper_id,
        action,
        context,
        created_at
      )
      select
        ${ownerId},
        ${papers[11].id}::uuid,
        'seen',
        'feed',
        now() - interval '30 minutes' + sequence * interval '1 second'
      from generate_series(1, 201) as sequence
    `;
    await sql`
      insert into user_paper_interactions (
        owner_id,
        paper_id,
        action,
        context,
        created_at
      ) values
        (${ownerId}, ${papers[10].id}::uuid, 'favorite', 'feed', now()),
        (${ownerId}, ${papers[10].id}::uuid, 'save_to_playlist', 'feed', now())
    `;

    const generatedAt = new Date().toISOString();
    await sql`
      insert into recommendations (
        owner_id,
        paper_id,
        score,
        reason,
        model_version,
        generated_at
      )
      select
        ${ownerId},
        paper.id::uuid,
        1000 - paper.ordinality,
        'Durable exclusion fixture',
        'paperdeck-initial-feed-v2',
        ${generatedAt}
      from unnest(${papers.map((paper) => paper.id)}::uuid[])
        with ordinality as paper(id, ordinality)
    `;

    const [state] = await sql<{
      cause: string;
      durable_count: number;
      total_exclusions: number;
      recent_count: number;
    }[]>`
      select
        (
          select cause::text
          from user_paper_feed_exclusions
          where owner_id = ${ownerId}
            and paper_id = ${durablePaperId}::uuid
        ) as cause,
        (
          select count(*)::integer
          from user_paper_feed_exclusions
          where owner_id = ${ownerId}
            and paper_id = ${durablePaperId}::uuid
        ) as durable_count,
        (
          select count(*)::integer
          from (
            select paper_id
            from user_paper_interactions
            where owner_id = ${ownerId}
            order by created_at desc
            limit 200
          ) recent
          where recent.paper_id = ${durablePaperId}::uuid
        ) as recent_count,
        (
          select count(*)::integer
          from user_paper_feed_exclusions
          where owner_id = ${ownerId}
        ) as total_exclusions
    `;
    expect(state).toEqual({
      cause: "open_detail",
      durable_count: 1,
      recent_count: 0,
      total_exclusions: 1,
    });
  } finally {
    await sql.end();
  }

  const response = await page.goto("/feed");
  expect(response?.status()).toBeLessThan(500);
  await expect(page.getByRole("link", { name: "Open" })).toHaveAttribute(
    "href",
    `/papers/${expectedVisiblePaperId}`,
  );

  const mutationSql = database();
  try {
    await mutationSql`
      delete from playlist_items
      where playlist_id = ${playlistId}::uuid
        and paper_id = ${playlistPaperId}::uuid
    `;
  } finally {
    await mutationSql.end();
  }

  await page.reload();
  await expect(page.getByRole("link", { name: "Open" })).toHaveAttribute(
    "href",
    `/papers/${playlistPaperId}`,
  );
});

test("the migration backfills only the latest durable action per paper", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Migration replay runs once.");

  const sql = database();
  const otherOwnerId = `${ownerId}-feed-exclusion-other`;
  let transactionOpen = false;
  try {
    const papers = await sql<{ id: string }[]>`
      select id from papers order by id limit 3
    `;
    expect(papers).toHaveLength(3);
    const migration = await readFile(
      path.join(
        process.cwd(),
        "supabase/migrations/20260811233124_durable_feed_exclusions.sql",
      ),
      "utf8",
    );

    await sql`begin`;
    transactionOpen = true;
    await sql`drop trigger user_paper_interactions_record_feed_exclusion on user_paper_interactions`;
    await sql`drop function private.record_user_paper_feed_exclusion()`;
    await sql`drop table user_paper_feed_exclusions`;
    await sql`
      insert into profiles (owner_id, onboarding_completed_at)
      values (${ownerId}, now()), (${otherOwnerId}, now())
    `;
    await sql`
      insert into user_paper_interactions (
        owner_id,
        paper_id,
        action,
        context,
        created_at
      ) values
        (${ownerId}, ${papers[0].id}::uuid, 'open_detail', 'feed', now() - interval '3 hours'),
        (${ownerId}, ${papers[0].id}::uuid, 'not_interested', 'feed', now() - interval '1 hour'),
        (${ownerId}, ${papers[1].id}::uuid, 'already_read', 'detail', now() - interval '2 hours'),
        (${ownerId}, ${papers[2].id}::uuid, 'favorite', 'feed', now()),
        (${otherOwnerId}, ${papers[2].id}::uuid, 'dismiss', 'feed', now())
    `;

    await sql.unsafe(migration);

    const rows = await sql<{
      cause: string;
      paper_id: string;
    }[]>`
      select paper_id::text, cause::text
      from user_paper_feed_exclusions
      where owner_id = ${ownerId}
      order by paper_id
    `;
    expect(rows).toEqual(
      [
        { cause: "not_interested", paper_id: papers[0].id },
        { cause: "already_read", paper_id: papers[1].id },
      ].sort((left, right) => left.paper_id.localeCompare(right.paper_id)),
    );

    const [security] = await sql<{
      policy_count: number;
      rls_enabled: boolean;
      security_definer: boolean;
    }[]>`
      select
        class.relrowsecurity as rls_enabled,
        procedure.prosecdef as security_definer,
        (
          select count(*)::integer
          from pg_policy policy
          where policy.polrelid = class.oid
        ) as policy_count
      from pg_class class
      join pg_namespace namespace on namespace.oid = class.relnamespace
      cross join pg_proc procedure
      join pg_namespace procedure_namespace
        on procedure_namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and class.relname = 'user_paper_feed_exclusions'
        and procedure_namespace.nspname = 'private'
        and procedure.proname = 'record_user_paper_feed_exclusion'
    `;
    expect(security).toEqual({
      policy_count: 1,
      rls_enabled: true,
      security_definer: false,
    });

    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId })}, true)`;
    await sql.unsafe("set local role authenticated");
    const [visibility] = await sql<{
      other_count: number;
      visible_count: number;
    }[]>`
      select
        count(*)::integer as visible_count,
        count(*) filter (where owner_id = ${otherOwnerId})::integer as other_count
      from user_paper_feed_exclusions
    `;
    expect(visibility).toEqual({ other_count: 0, visible_count: 2 });

    await sql`rollback`;
    transactionOpen = false;
  } finally {
    if (transactionOpen) await sql`rollback`;
    await sql.end();
  }
});
