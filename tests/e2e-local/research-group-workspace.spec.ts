import { expect, test } from "@playwright/test";
import postgres from "postgres";

const mode = process.env.PAPERDECK_GROUP_UI_MODE ?? "owner";
const seededGroupPath = "/groups/40000000-0000-4000-8000-000000000001";

async function withDatabase<T>(task: (sql: postgres.Sql) => Promise<T>) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
  try {
    return await task(sql);
  } finally {
    await sql.end();
  }
}

test("member permissions, preference, and leave flow", async ({ page }) => {
  test.skip(mode !== "member", "Member phase only");

  await page.goto(seededGroupPath, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Local research group" })).toBeVisible();
  await expect(page.getByText("member", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Send invitation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete group" })).toHaveCount(0);

  await page.getByRole("combobox").selectOption("important_only");
  await expect.poll(() => withDatabase(async (sql) => {
    const rows = await sql<{ paper_notification_preference: string }[]>`
      select paper_notification_preference
      from research_group_members
      where group_id = '40000000-0000-4000-8000-000000000001'
        and member_id = 'local-group-member'
    `;
    return rows[0]?.paper_notification_preference;
  })).toBe("important_only");

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Leave group" }).click();
  await expect(page).toHaveURL(/\/groups$/);
  await expect(page.getByText("Local research group")).toHaveCount(0);

  await page.goto(seededGroupPath, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "This page could not be found.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Local research group" }),
  ).toHaveCount(0);
});

test("owner workspace operations preserve personal ranking isolation", async ({ page }) => {
  test.skip(mode !== "owner", "Owner phase only");

  await page.goto("/groups", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Research groups" })).toBeVisible();

  await page.getByRole("button", { name: "New group" }).click();
  const createDialog = page.getByRole("dialog", { name: "Create research group" });
  await createDialog.getByLabel("Name").fill("Disposable browser group");
  await createDialog.getByLabel(/Description/).fill("Created and removed by the isolated test.");
  await createDialog.getByRole("button", { name: "Create group", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Disposable browser group" })).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete group" }).click();
  await expect(page).toHaveURL(/\/groups$/);

  await page.getByRole("link", { name: /Local research group/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Local research group" })).toBeVisible();
  await expect(page.getByText("Members · 2")).toBeVisible();

  const personalCountsBefore = await withDatabase(async (sql) => {
    const rows = await sql<{ interactions: number; favorites: number; recommendations: number }[]>`
      select
        (select count(*)::int from user_paper_interactions where owner_id = 'local-group-owner') as interactions,
        (select count(*)::int from favorites where owner_id = 'local-group-owner') as favorites,
        (select count(*)::int from recommendations where owner_id = 'local-group-owner') as recommendations
    `;
    return rows[0];
  });

  await page.getByRole("button", { name: "Add paper" }).click();
  const addDialog = page.getByRole("dialog", { name: "Add paper to group" });
  await addDialog.getByRole("searchbox").fill("Synthetic Retrieval");
  await addDialog.getByRole("button", { name: "Search", exact: true }).click();
  await expect(addDialog.getByText("Synthetic Retrieval for Shared Reading")).toBeVisible();
  await addDialog.getByRole("button", { name: "Add to group" }).click();
  await expect(addDialog.getByRole("button", { name: "Added" })).toBeVisible();
  await addDialog.getByRole("button", { name: "Close paper search" }).click();
  await expect(page.getByText("Synthetic Retrieval for Shared Reading")).toBeVisible();

  const afterGroupAdd = await withDatabase(async (sql) => {
    const counts = await sql<{ interactions: number; favorites: number; recommendations: number }[]>`
      select
        (select count(*)::int from user_paper_interactions where owner_id = 'local-group-owner') as interactions,
        (select count(*)::int from favorites where owner_id = 'local-group-owner') as favorites,
        (select count(*)::int from recommendations where owner_id = 'local-group-owner') as recommendations
    `;
    const groupRows = await sql<{ count: number }[]>`
      select count(*)::int as count
      from research_group_paper_items
      where group_id = '40000000-0000-4000-8000-000000000001'
        and paper_id = '30000000-0000-4000-8000-000000000002'
    `;
    return { ...counts[0], groupItems: groupRows[0]?.count };
  });
  expect(afterGroupAdd).toEqual({ ...personalCountsBefore, groupItems: 1 });

  const retrievalCard = page.getByRole("article").filter({
    hasText: "Synthetic Retrieval for Shared Reading",
  });
  await retrievalCard.getByRole("button", { name: "Save privately" }).click();
  const picker = page.getByRole("dialog", { name: "Save to playlists" });
  await picker.getByLabel("Read later").check();
  await picker.getByRole("button", { name: "Done" }).click();
  await expect(retrievalCard.getByRole("button", { name: "Saved privately" })).toBeVisible();

  const privateSave = await withDatabase(async (sql) => {
    const rows = await sql<{ playlist_items: number; group_context_saves: number }[]>`
      select
        (
          select count(*)::int
          from playlist_items as item
          join playlists as playlist on playlist.id = item.playlist_id
          where playlist.owner_id = 'local-group-owner'
            and item.paper_id = '30000000-0000-4000-8000-000000000002'
        ) as playlist_items,
        (
          select count(*)::int
          from user_paper_interactions
          where owner_id = 'local-group-owner'
            and paper_id = '30000000-0000-4000-8000-000000000002'
            and action = 'save_to_playlist'
            and context = 'group'
        ) as group_context_saves
    `;
    return rows[0];
  });
  expect(privateSave).toEqual({ playlist_items: 1, group_context_saves: 1 });

  await retrievalCard.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Synthetic Retrieval for Shared Reading")).toHaveCount(0);

  const adminRow = page.getByText("Local admin", { exact: true }).locator("..").locator("..");
  await adminRow.getByRole("button", { name: "Make member" }).click();
  await expect(adminRow.getByRole("button", { name: "Make admin" })).toBeVisible();
  await adminRow.getByRole("button", { name: "Make admin" }).click();
  await expect(adminRow.getByRole("button", { name: "Make member" })).toBeVisible();
});

test("mobile workspace has meaningful content without an error overlay", async ({ page }) => {
  test.skip(mode !== "mobile", "Mobile phase only");

  await page.goto(seededGroupPath, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Local research group" })).toBeVisible();
  await expect(page.getByText("Synthetic Distributed Systems Baseline")).toBeVisible();
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  expect((await page.locator("body").innerText()).trim().length).toBeGreaterThan(100);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
