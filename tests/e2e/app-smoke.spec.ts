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

async function withDb<T>(task: (sql: postgres.Sql) => Promise<T>) {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for app smoke database setup");
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1 });

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

async function completeDevOnboardingWithTopics(page: Page) {
  await resetDevOwner();

  const response = await page.goto("/onboarding");

  expect(response?.status()).toBeLessThan(500);
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
}

test.describe("dev-auth app smoke", () => {
  test.describe.configure({ mode: "serial" });

  test.skip(
    !devAuthEnabled,
    "Run without PAPERDECK_E2E_DEV_AUTH=false for dev-auth app smoke tests.",
  );

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
    await expect(
      page.getByRole("heading", { exact: true, name: "Today" }),
    ).toBeVisible();
  });

  for (const { path, heading } of [
    { path: "/feed", heading: "Today" },
    { path: "/onboarding", heading: "Macro areas" },
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
      await expect(
        page.getByRole("heading", { exact: true, name: heading }),
      ).toBeVisible();
      if (path === "/onboarding") {
        await expect(page.getByText("Selected", { exact: true })).toHaveCount(0);
      }
      await expect(
        page.getByRole("banner").getByText("Local dev"),
      ).toBeVisible();
    });
  }
});
