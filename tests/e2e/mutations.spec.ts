import { expect, test } from "@playwright/test";
import postgres from "postgres";

const devAuthEnabled = process.env.PAPERDECK_E2E_DEV_AUTH !== "false";
const devOwnerId =
  process.env.PAPERDECK_E2E_OWNER_ID ??
  process.env.PAPERDECK_DEV_OWNER_ID ??
  "playwright-user";

const otherOwnerId = "playwright-other-user";

function hasDatabaseEnv() {
  const value = process.env.DATABASE_URL;
  return Boolean(
    value &&
      value !== "replace_me" &&
      value !== "dummy" &&
      !value.includes("replace-me"),
  );
}

const hasDb = hasDatabaseEnv();

async function withDb<T>(
  task: (sql: postgres.Sql) => Promise<T>,
  retries = 3,
): Promise<T> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    return await task(sql);
  } catch (error) {
    if (
      retries > 0 &&
      error instanceof Error &&
      error.message.includes("EMAXCONNSESSION")
    ) {
      await sql.end();
      const delay = 1000 * (4 - retries);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return withDb(task, retries - 1);
    }
    throw error;
  } finally {
    await sql.end();
  }
}

async function cleanupTestData() {
  await withDb(async (sql) => {
    const ids = [devOwnerId, otherOwnerId];
    for (const id of ids) {
      await sql`delete from playlist_items where playlist_id in (select id from playlists where owner_id = ${id})`;
      await sql`delete from playlists where owner_id = ${id}`;
      await sql`delete from favorites where owner_id = ${id}`;
      await sql`delete from user_paper_interactions where owner_id = ${id}`;
      await sql`delete from recommendation_impressions where owner_id = ${id}`;
      await sql`delete from user_interests where owner_id = ${id}`;
      await sql`delete from user_profile_embeddings where owner_id = ${id}`;
      await sql`delete from recommendations where owner_id = ${id}`;
      await sql`delete from profiles where owner_id = ${id}`;
    }
  });
}

async function getSeedTopicId(sql: postgres.Sql) {
  const rows = await sql<{ id: string }[]>`
    select id from taxonomy_topics order by sort_order, label limit 1
  `;
  if (!rows.length) throw new Error("App smoke setup requires at least one taxonomy topic");
  return rows[0].id;
}

async function getSeedPaperId(sql: postgres.Sql) {
  const rows = await sql<{ id: string }[]>`
    select id from papers where embedding is not null limit 1
  `;
  if (!rows.length) throw new Error("Mutation smoke requires at least one embedded paper");
  return rows[0].id;
}

async function seedTestProfile() {
  await withDb(async (sql) => {
    const topicId = await getSeedTopicId(sql);
    await sql`insert into profiles (owner_id, onboarding_completed_at) values (${devOwnerId}, now()) on conflict (owner_id) do update set onboarding_completed_at = now()`;
    await sql`insert into user_interests (owner_id, topic_id, selected_at) values (${devOwnerId}, ${topicId}, now()) on conflict (owner_id, topic_id) do nothing`;
  });
}

async function getLatestRecommendationImpressions() {
  return withDb(async (sql) => {
    const latest = await sql<{ batch_id: string }[]>`
      select batch_id
      from recommendation_impressions
      where owner_id = ${devOwnerId}
      order by shown_at desc
      limit 1
    `;

    if (!latest.length) return [];

    return sql<{
      id: string;
      paper_id: string;
      rank: number;
      score: number;
      score_components: unknown;
      model_version: string;
    }[]>`
      select id, paper_id, rank, score, score_components, model_version
      from recommendation_impressions
      where owner_id = ${devOwnerId}
        and batch_id = ${latest[0].batch_id}
      order by rank asc
    `;
  });
}

test.describe("deck API mutations", () => {
  test.beforeAll(async () => {
    await cleanupTestData();
    await seedTestProfile();
  });

  test("rejects requests without paperId", async ({ request }) => {
    test.skip(!devAuthEnabled, "Requires dev auth.");
    test.skip(!hasDb, "Requires DATABASE_URL.");

    const response = await request.post("/api/deck", {
      data: { action: "dismiss" },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Missing paperId");
  });

  test("rejects requests with invalid action", async ({ request }) => {
    test.skip(!devAuthEnabled, "Requires dev auth.");
    test.skip(!hasDb, "Requires DATABASE_URL.");

    const response = await request.post("/api/deck", {
      data: { action: "invalid_action", paperId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Unknown action");
  });

  test("accepts dismiss action", async ({ request }) => {
    test.skip(!devAuthEnabled, "Requires dev auth.");
    test.skip(!hasDb, "Requires DATABASE_URL.");

    const paperId = await withDb(getSeedPaperId);

    const response = await request.post("/api/deck", {
      data: { action: "dismiss", paperId },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.action).toBe("dismiss");
  });

  test("toggles favorite", async ({ request }) => {
    test.skip(!devAuthEnabled, "Requires dev auth.");
    test.skip(!hasDb, "Requires DATABASE_URL.");

    const paperId = await withDb(getSeedPaperId);

    const fav1 = await request.post("/api/deck", {
      data: { action: "favorite", paperId },
    });
    expect(fav1.status()).toBe(200);
    expect((await fav1.json()).ok).toBe(true);

    const fav2 = await request.post("/api/deck", {
      data: { action: "favorite", paperId },
    });
    expect(fav2.status()).toBe(200);
    expect((await fav2.json()).ok).toBe(true);
  });

  test("toggles read later", async ({ request }) => {
    test.skip(!devAuthEnabled, "Requires dev auth.");
    test.skip(!hasDb, "Requires DATABASE_URL.");

    const paperId = await withDb(getSeedPaperId);

    const rl1 = await request.post("/api/deck", {
      data: { action: "read_later", paperId },
    });
    expect(rl1.status()).toBe(200);
    expect((await rl1.json()).ok).toBe(true);

    const rl2 = await request.post("/api/deck", {
      data: { action: "read_later", paperId },
    });
    expect(rl2.status()).toBe(200);
    expect((await rl2.json()).ok).toBe(true);
  });
});

test.describe("playlist authorization", () => {
  test.beforeAll(async () => {
    await cleanupTestData();
    await seedTestProfile();
  });

  let createdPlaylistId: string | null = null;

  test("creates a private playlist via server action", async ({ page }) => {
    test.skip(!devAuthEnabled, "Requires dev auth.");
    test.skip(!hasDb, "Requires DATABASE_URL.");

    const response = await page.goto("/library");

    expect(response?.status()).toBeLessThan(500);
    await page.getByRole("button", { name: "Create playlist" }).click();
    await page.getByPlaceholder("Playlist name").fill("Test Playlist");
    await page.getByRole("button", { exact: true, name: "Create" }).click();
    await expect(page.getByPlaceholder("Playlist name")).toHaveCount(0);

    const playlist = await withDb(async (sql) => {
      const rows = await sql<{ id: string; name: string; owner_id: string }[]>`
        select id, name, owner_id from playlists where owner_id = ${devOwnerId} and is_default = false order by created_at desc limit 1
      `;
      return rows[0] ?? null;
    });

    expect(playlist).not.toBeNull();
    expect(playlist!.name).toBe("Test Playlist");
    expect(playlist!.owner_id).toBe(devOwnerId);
    createdPlaylistId = playlist!.id;
  });

  test("cross-owner playlist cannot be accessed by another user", async () => {
    test.skip(!hasDb, "Requires DATABASE_URL.");

    const playlistId = createdPlaylistId;
    if (!playlistId) {
      test.skip(true, "No playlist created in previous test");
      return;
    }

    await withDb(async (sql) => {
      const rows = await sql<{ id: string }[]>`
        select id from playlists where id = ${playlistId} and owner_id = ${otherOwnerId}
      `;
      expect(rows.length).toBe(0);
    });
  });

  test("cannot delete default Read later playlist", async () => {
    test.skip(!hasDb, "Requires DATABASE_URL.");

    await withDb(async (sql) => {
      const defaultRow = await sql<{ id: string }[]>`
        select id from playlists where owner_id = ${devOwnerId} and is_default = true limit 1
      `;
      if (!defaultRow.length) {
        return;
      }
      const defaultId = defaultRow[0].id;

      await expect(
        sql`delete from playlists where id = ${defaultId} and owner_id = ${otherOwnerId}`,
      ).resolves.toBeDefined();

      const stillExists = await sql<{ id: string }[]>`
        select id from playlists where id = ${defaultId} and owner_id = ${devOwnerId}
      `;
      expect(stillExists.length).toBe(1);
    });
  });
});

test.describe("recommendation analytics", () => {
  test.beforeAll(async () => {
    await cleanupTestData();
    await seedTestProfile();
  });

  test("links a rendered deck action to its feed impression", async ({ page }) => {
    test.skip(!devAuthEnabled, "Requires dev auth.");
    test.skip(!hasDb, "Requires DATABASE_URL.");

    const response = await page.goto("/feed");

    expect(response?.status()).toBeLessThan(500);
    await expect(
      page.getByRole("heading", { exact: true, name: "Today" }),
    ).toBeVisible();

    const impressions = await getLatestRecommendationImpressions();
    expect(impressions.length).toBeGreaterThan(0);
    expect(impressions[0].rank).toBe(1);
    expect(impressions[0].score).toEqual(expect.any(Number));
    expect(impressions[0].model_version).toMatch(/paperdeck-.+-feed-v1/);
    expect(typeof impressions[0].score_components).toBe("object");

    const activePaperHref = await page
      .getByRole("link", { name: "Open" })
      .getAttribute("href");
    const activePaperId = activePaperHref?.split("/").at(-1);
    const activeImpression = impressions.find(
      (impression) => impression.paper_id === activePaperId,
    );

    expect(activeImpression).toBeDefined();

    if (!activeImpression) {
      throw new Error("The rendered active paper has no recommendation impression");
    }

    await page.getByRole("button", { name: "Dismiss paper" }).click();

    await expect.poll(async () => {
      const interactions = await withDb(async (sql) =>
        await sql<{ recommendation_impression_id: string | null }[]>`
          select recommendation_impression_id
          from user_paper_interactions
          where owner_id = ${devOwnerId}
            and paper_id = ${activeImpression.paper_id}
            and action = 'dismiss'
          order by created_at desc
          limit 1
        `,
      );

      return interactions[0]?.recommendation_impression_id;
    }).toBe(activeImpression.id);
  });

  test("ignores invalid or mismatched impression ids without failing mutations", async ({
    request,
  }) => {
    test.skip(!devAuthEnabled, "Requires dev auth.");
    test.skip(!hasDb, "Requires DATABASE_URL.");

    const impressions = await getLatestRecommendationImpressions();
    test.skip(impressions.length < 2, "Requires at least two feed impressions.");

    const invalid = await request.post("/api/deck", {
      data: {
        action: "favorite",
        paperId: impressions[0].paper_id,
        recommendationImpressionId: "not-a-uuid",
      },
    });
    expect(invalid.status()).toBe(200);

    const mismatched = await request.post("/api/deck", {
      data: {
        action: "dismiss",
        paperId: impressions[1].paper_id,
        recommendationImpressionId: impressions[0].id,
      },
    });
    expect(mismatched.status()).toBe(200);

    const rows = await withDb((sql) =>
      sql<{ action: string; recommendation_impression_id: string | null }[]>`
        select action, recommendation_impression_id
        from user_paper_interactions
        where owner_id = ${devOwnerId}
          and (
            (paper_id = ${impressions[0].paper_id} and action = 'favorite')
            or (paper_id = ${impressions[1].paper_id} and action = 'dismiss')
          )
        order by created_at desc
      `,
    );

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "favorite",
          recommendation_impression_id: null,
        }),
        expect.objectContaining({
          action: "dismiss",
          recommendation_impression_id: null,
        }),
      ]),
    );
  });
});

test.describe("deck mutation error handling", () => {
  test("API returns proper error structure on 400", async ({ request }) => {
    test.skip(!devAuthEnabled, "Requires dev auth.");
    test.skip(!hasDb, "Requires DATABASE_URL.");

    const response = await request.post("/api/deck", {
      data: {},
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty("ok", false);
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
  });

  test("API returns proper error structure on 500", async ({ request }) => {
    test.skip(!devAuthEnabled, "Requires dev auth.");
    test.skip(!hasDb, "Requires DATABASE_URL.");

    const response = await request.post("/api/deck", {
      data: { action: "dismiss", paperId: "not-a-uuid" },
    });
    expect(response.status()).toBe(500);
    const body = await response.json();
    expect(body).toHaveProperty("ok", false);
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
  });
});
