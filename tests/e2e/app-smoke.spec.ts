import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const devAuthEnabled = process.env.PAPERDECK_E2E_DEV_AUTH !== "false";
const devOwnerId =
  process.env.PAPERDECK_E2E_OWNER_ID ??
  process.env.PAPERDECK_DEV_OWNER_ID ??
  "playwright-user";

function hasConfiguredEnv(name: string) {
  const value = process.env[name];

  return Boolean(
    value &&
      value !== "replace_me" &&
      value !== "dummy" &&
      !value.includes("replace-me"),
  );
}

const hasDatabaseEnv = hasConfiguredEnv("DATABASE_URL");
const appSmokeTimeoutMs = 60_000;
const feedReadyTimeoutMs = 25_000;

async function withDb<T>(task: (sql: postgres.Sql) => Promise<T>) {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for app smoke database setup");
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });

  try {
    return await task(sql);
  } finally {
    await sql.end();
  }
}

async function resetDevOwner() {
  await withDb(async (sql) => {
    await sql`delete from profiles where owner_id = ${devOwnerId}`;
  });
}

async function getSeedTopicId(sql: postgres.Sql) {
  const rows = await sql<{ id: string }[]>`
    select id from taxonomy_topics order by sort_order, label limit 1
  `;

  if (!rows.length) {
    throw new Error("App smoke setup requires at least one taxonomy topic");
  }

  return rows[0].id;
}

async function seedCompletedDevOwner() {
  await withDb(async (sql) => {
    await sql`delete from profiles where owner_id = ${devOwnerId}`;
    await sql`
      insert into profiles (owner_id, onboarding_completed_at)
      values (${devOwnerId}, now())
    `;
  });
}

async function seedCompletedDevOwnerWithReadLater() {
  await withDb(async (sql) => {
    await sql`delete from profiles where owner_id = ${devOwnerId}`;
    await sql`
      insert into profiles (owner_id, onboarding_completed_at)
      values (${devOwnerId}, now())
    `;
    await sql`
      insert into playlists (owner_id, name, is_default)
      values (${devOwnerId}, 'Read later', true)
    `;
  });
}

async function profileBootstrapSnapshot() {
  return withDb(async (sql) => {
    const [state] = await sql<{
      playlist_rows: Array<Record<string, unknown>>;
      profile_rows: Array<Record<string, unknown>>;
    }[]>`
      select
        (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', id,
                'xmin', xmin::text,
                'updated_at', updated_at
              ) order by id
            ),
            '[]'::jsonb
          )
          from playlists
          where owner_id = ${devOwnerId}
        ) as playlist_rows,
        (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'owner_id', owner_id,
                'xmin', xmin::text,
                'updated_at', updated_at
              ) order by owner_id
            ),
            '[]'::jsonb
          )
          from profiles
          where owner_id = ${devOwnerId}
        ) as profile_rows
    `;
    return state;
  });
}

async function seedLegacyInterestDevOwner() {
  await withDb(async (sql) => {
    const topicId = await getSeedTopicId(sql);

    await sql`delete from profiles where owner_id = ${devOwnerId}`;
    await sql`insert into profiles (owner_id) values (${devOwnerId})`;
    await sql`
      insert into user_interests (owner_id, topic_id)
      values (${devOwnerId}, ${topicId})
    `;
  });
}

async function seedSettingsInterestDevOwner() {
  return withDb(async (sql) => {
    const topics = await sql<{ id: string; label: string }[]>`
      select id, label
      from taxonomy_topics
      order by sort_order, label
      limit 2
    `;

    if (topics.length < 2) {
      throw new Error("Settings smoke setup requires at least two taxonomy topics");
    }

    await sql`delete from profiles where owner_id = ${devOwnerId}`;
    await sql`
      insert into profiles (owner_id, onboarding_completed_at)
      values (${devOwnerId}, now())
    `;
    await sql`
      insert into user_interests (owner_id, topic_id)
      values (${devOwnerId}, ${topics[0].id})
    `;

    return topics[0];
  });
}

async function seedIgnoredHistoryDevOwner() {
  return withDb(async (sql) => {
    const papers = await sql<{ id: string; title: string }[]>`
      select id, title from papers order by published_at desc nulls last, title limit 2
    `;

    if (papers.length < 2) {
      throw new Error("Ignored history smoke setup requires at least two papers");
    }

    await sql`delete from profiles where owner_id = ${devOwnerId}`;
    await sql`
      insert into profiles (owner_id, onboarding_completed_at)
      values (${devOwnerId}, now())
    `;
    await sql`
      insert into user_paper_interactions (owner_id, paper_id, action, context, created_at)
      values
        (${devOwnerId}, ${papers[0].id}, 'dismiss', 'feed', now() - interval '2 minutes'),
        (${devOwnerId}, ${papers[0].id}, 'not_interested', 'feed', now() - interval '1 minute'),
        (${devOwnerId}, ${papers[1].id}, 'dismiss', 'feed', now())
    `;

    return papers;
  });
}

async function seedPaginatedLibraryDevOwner() {
  return withDb(async (sql) => {
    const papers = await sql<{ id: string }[]>`
      select id from papers order by published_at desc nulls last, title limit 30
    `;

    if (papers.length < 30) {
      throw new Error("Paginated Library smoke setup requires 30 papers");
    }

    await sql`delete from profiles where owner_id = ${devOwnerId}`;
    await sql`
      insert into profiles (owner_id, onboarding_completed_at)
      values (${devOwnerId}, now())
    `;
    const [playlist] = await sql<{ id: string }[]>`
      insert into playlists (owner_id, name, is_default)
      values (${devOwnerId}, 'Read later', true)
      returning id
    `;
    const items = papers.map((paper, position) => ({
      paper_id: paper.id,
      playlist_id: playlist.id,
      position,
    }));
    await sql`
      insert into playlist_items ${sql(
        items,
        "playlist_id",
        "paper_id",
        "position",
      )}
    `;
  });
}

async function completeDevOnboardingWithTopics(page: Page) {
  await resetDevOwner();

  const response = await page.goto("/onboarding");

  expect(response?.status()).toBeLessThan(500);
  expect(await profileBootstrapSnapshot()).toEqual({
    playlist_rows: [],
    profile_rows: [],
  });
  await expect(
    page.getByRole("heading", { exact: true, name: "Your public name" }),
  ).toBeVisible();
  await page.getByLabel("Public display name").fill("Playwright Researcher");
  await page.getByRole("button", { exact: true, name: "Next" }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "Macro areas" }),
  ).toBeVisible();
  await page.locator("section button").first().click();
  await page.getByRole("button", { exact: true, name: "Next" }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "Categories" }),
  ).toBeVisible();
  await page.locator("section button").first().click();
  await page.getByRole("button", { exact: true, name: "Next" }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "Microcategories" }),
  ).toBeVisible();

  const microcategoryButtons = page.locator("section button");

  if ((await microcategoryButtons.count()) > 0) {
    await microcategoryButtons.first().click();
  }

  await page
    .getByRole("button", { exact: true, name: "Start PaperDeck" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    /Saving your interests|Building your preference vector|Ranking your first papers/,
  );
  await expect(page).toHaveURL(/\/feed/);
  await expectFeedReady(page);
  const provisioned = await profileBootstrapSnapshot();
  expect(provisioned.profile_rows).toHaveLength(1);
  expect(provisioned.playlist_rows).toHaveLength(1);
}

async function expectFeedReady(page: Page) {
  await expect(
    page.getByRole("heading", { exact: true, name: "Today" }),
  ).toBeVisible({ timeout: feedReadyTimeoutMs });
}

test.describe("dev-auth app smoke", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(appSmokeTimeoutMs);

  test.skip(
    !devAuthEnabled,
    "Run without PAPERDECK_E2E_DEV_AUTH=false for dev-auth app smoke tests.",
  );

  test.afterAll(async () => {
    if (hasDatabaseEnv) {
      await resetDevOwner();
    }
  });

  test("sign-in exits to the app when dev auth is enabled", async ({
    request,
  }) => {
    const response = await request.get("/sign-in", { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    expect(response.headers().location).toContain("/feed");
  });

  test("root redirects fresh users to onboarding", async ({ request }) => {
    test.skip(!hasDatabaseEnv, "Requires DATABASE_URL.");

    await resetDevOwner();

    const response = await request.get("/", { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    expect(response.headers().location).toContain("/onboarding");
  });

  test("root redirects completed users to feed", async ({ request }) => {
    test.skip(!hasDatabaseEnv, "Requires DATABASE_URL.");

    await seedCompletedDevOwner();

    const response = await request.get("/", { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    expect(response.headers().location).toContain("/feed");
  });

  test("root redirects legacy users with saved interests to feed", async ({
    request,
  }) => {
    test.skip(!hasDatabaseEnv, "Requires DATABASE_URL.");

    await seedLegacyInterestDevOwner();

    const response = await request.get("/", { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    expect(response.headers().location).toContain("/feed");
  });

  test("topic onboarding final submit redirects to feed", async ({ page }) => {
    test.skip(!hasDatabaseEnv, "Requires DATABASE_URL.");

    await completeDevOnboardingWithTopics(page);
  });

  test("onboarding redirects completed users to feed", async ({ page }) => {
    test.skip(!hasDatabaseEnv, "Requires DATABASE_URL.");

    await seedCompletedDevOwner();

    const response = await page.goto("/onboarding");

    expect(response?.status()).toBeLessThan(500);
    await expect(page).toHaveURL(/\/feed/);
    await expectFeedReady(page);
  });

  test("search and settings renders do not write profile bootstrap rows", async ({
    page,
  }) => {
    test.skip(!hasDatabaseEnv, "Requires DATABASE_URL.");

    await seedCompletedDevOwnerWithReadLater();
    const before = await profileBootstrapSnapshot();

    await page.goto("/search");
    await expect(
      page.getByRole("heading", { exact: true, name: "Search" }),
    ).toBeVisible();
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { exact: true, name: "Settings" }),
    ).toBeVisible();

    expect(await profileBootstrapSnapshot()).toEqual(before);
  });

  test("library shows ignored paper history", async ({ page }) => {
    test.skip(!hasDatabaseEnv, "Requires DATABASE_URL.");

    const papers = await seedIgnoredHistoryDevOwner();

    const response = await page.goto("/library");

    expect(response?.status()).toBeLessThan(500);
    await expect(
      page.getByRole("heading", { exact: true, name: "Read later" }),
    ).toBeVisible();
    const ignoredLoaded = page.waitForResponse(
      (collectionResponse) =>
        collectionResponse.url().includes(
          "/api/library/collections?collection=ignored",
        ) && collectionResponse.status() === 200,
    );
    await page.getByRole("button", { name: /^Ignored/ }).click();
    await ignoredLoaded;
    await expect(
      page.getByRole("heading", { exact: true, name: "Ignored" }),
    ).toBeVisible();
    await expect(page.getByText("Not interested")).toBeVisible();
    await expect(page.getByText("Dismissed")).toBeVisible();
    await expect(page.getByText(papers[0].title)).toHaveCount(1);
    await expect(page.getByText(papers[1].title)).toHaveCount(1);
  });

  test("library loads later pages only after an explicit request", async ({
    page,
  }) => {
    test.skip(!hasDatabaseEnv, "Requires DATABASE_URL.");

    await seedPaginatedLibraryDevOwner();
    const collectionRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/library/collections")) {
        collectionRequests.push(request.url());
      }
    });

    const response = await page.goto("/library");
    expect(response?.status()).toBeLessThan(500);
    const paperLinks = page.locator(
      'section[aria-labelledby="library-collection-title"] a[href^="/papers/"]',
    );
    await expect(paperLinks).toHaveCount(24);
    expect(collectionRequests).toHaveLength(0);
    await expect(page.getByRole("button", { name: "Load more papers" })).toBeVisible();

    const nextPageLoaded = page.waitForResponse(
      (collectionResponse) =>
        collectionResponse.url().includes("collection=read-later") &&
        collectionResponse.url().includes("cursor=") &&
        collectionResponse.status() === 200,
    );
    await page.getByRole("button", { name: "Load more papers" }).click();
    await nextPageLoaded;

    await expect(paperLinks).toHaveCount(30);
    await expect(
      page.getByRole("button", { name: "Load more papers" }),
    ).toHaveCount(0);
    expect(collectionRequests).toHaveLength(1);
  });

  test("settings interests persist only after explicit save", async ({ page }) => {
    test.skip(!hasDatabaseEnv, "Requires DATABASE_URL.");

    const initialTopic = await seedSettingsInterestDevOwner();
    const response = await page.goto("/settings");

    expect(response?.status()).toBeLessThan(500);

    const saveButton = page.getByRole("button", {
      exact: true,
      name: "Save changes",
    });
    await expect(saveButton).toBeDisabled();
    const newTopicButton = page
      .getByRole("heading", { exact: true, name: "Microcategories" })
      .locator("..")
      .getByRole("button")
      .first();
    const newTopicLabel = await newTopicButton.textContent();
    expect(newTopicLabel).toBeTruthy();
    await newTopicButton.click();
    await expect(saveButton).toBeEnabled();

    const newTopic = await withDb(async (sql) => {
      const rows = await sql<{ id: string }[]>`
        select id
        from taxonomy_topics
        where label = ${newTopicLabel!}
        limit 1
      `;
      return rows[0];
    });
    expect(newTopic).toBeTruthy();

    const beforeSave = await withDb((sql) => sql<{ topic_id: string }[]>`
      select topic_id
      from user_interests
      where owner_id = ${devOwnerId}
    `);
    expect(beforeSave.map((row) => row.topic_id)).toEqual([initialTopic.id]);

    await saveButton.click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    const afterSave = await withDb((sql) => sql<{ topic_id: string }[]>`
      select topic_id
      from user_interests
      where owner_id = ${devOwnerId}
      order by topic_id
    `);
    expect(afterSave.map((row) => row.topic_id).sort()).toEqual(
      [initialTopic.id, newTopic.id].sort(),
    );
  });

  test("settings presents exact-email discovery as explicit opt-in", async ({
    page,
  }) => {
    test.skip(!hasDatabaseEnv, "Requires DATABASE_URL.");

    await seedCompletedDevOwner();
    const response = await page.goto("/settings");

    expect(response?.status()).toBeLessThan(500);
    const discoveryToggle = page.getByRole("checkbox", {
      name: /Find me by exact email/,
    });
    await expect(discoveryToggle).not.toBeChecked();
    await expect(
      page.getByText(/Off by default.*exact email/s),
    ).toBeVisible();

    await discoveryToggle.check();
    await expect(discoveryToggle).toBeChecked();
    await page.reload();
    await expect(discoveryToggle).not.toBeChecked();
  });

  test("search returns fixture papers through the migrated search schema", async ({
    page,
  }) => {
    test.skip(!hasDatabaseEnv, "Requires DATABASE_URL.");

    await seedCompletedDevOwner();
    const response = await page.goto(
      "/search?q=Synthetic%20research%20paper%2060",
    );

    expect(response?.status()).toBeLessThan(500);
    await expect(
      page.getByRole("heading", {
        exact: true,
        name: "Synthetic research paper 60",
      }),
    ).toBeVisible();
  });

  for (const { path, heading } of [
    { path: "/feed", heading: "Today" },
    { path: "/digest", heading: "Digest" },
    { path: "/onboarding", heading: "Your public name" },
    { path: "/search", heading: "Search" },
    { path: "/library", heading: "Library" },
    { path: "/settings", heading: "Settings" },
  ]) {
    test(`${path} renders without a server error`, async ({ page }) => {
      test.skip(
        !hasDatabaseEnv,
        "Requires DATABASE_URL.",
      );

      if (path === "/onboarding") {
        await resetDevOwner();
      } else {
        await seedCompletedDevOwner();
      }

      const response = await page.goto(path);

      expect(response?.status()).toBeLessThan(500);
      if (path === "/feed") {
        await expectFeedReady(page);
      } else {
        await expect(
          page.getByRole("heading", { exact: true, name: heading }),
        ).toBeVisible();
      }
      if (path === "/onboarding") {
        await expect(page.getByText("Selected", { exact: true })).toHaveCount(0);
      }
      await expect(
        page.getByRole("banner").getByText("Local dev"),
      ).toBeVisible();
    });
  }
});
