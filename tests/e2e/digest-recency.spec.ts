import { expect, test } from "@playwright/test";
import postgres from "postgres";

const devAuthEnabled = process.env.PAPERDECK_E2E_DEV_AUTH !== "false";
const hasDatabase = Boolean(process.env.DATABASE_URL);
const ownerId =
  process.env.PAPERDECK_E2E_OWNER_ID ??
  process.env.PAPERDECK_DEV_OWNER_ID ??
  "playwright-user";
const dayMs = 24 * 60 * 60 * 1000;

type PaperFixture = {
  id: string;
  ingestedAt: string;
  publishedAt: string | null;
  title: string;
};

let originalPapers: PaperFixture[] = [];

function database() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for digest recency tests");
  }

  return postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
}

async function seedDigest(daysAgoByRank: number[]) {
  const sql = database();
  try {
    originalPapers = await sql<PaperFixture[]>`
      select
        id,
        ingested_at as "ingestedAt",
        published_at as "publishedAt",
        title
      from papers
      order by id
      limit ${daysAgoByRank.length}
    `;
    expect(originalPapers).toHaveLength(daysAgoByRank.length);

    await sql`delete from profiles where owner_id = ${ownerId}`;
    await sql`
      insert into profiles (owner_id, onboarding_completed_at)
      values (${ownerId}, now())
    `;

    const nowMs = Date.now();
    for (const [index, paper] of originalPapers.entries()) {
      const publishedAt = new Date(
        nowMs - daysAgoByRank[index] * dayMs,
      ).toISOString();
      await sql`
        update papers
        set published_at = ${publishedAt}
        where id = ${paper.id}::uuid
      `;
    }

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
        ranked.paper_id::uuid,
        1000 - ranked.ordinality,
        'Digest recency fixture',
        'paperdeck-initial-feed-v2',
        ${generatedAt}
      from unnest(${originalPapers.map((paper) => paper.id)}::uuid[])
        with ordinality as ranked(paper_id, ordinality)
    `;

    return originalPapers;
  } finally {
    await sql.end();
  }
}

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Repository behavior runs once.");
  test.skip(!devAuthEnabled, "Requires dev auth.");
  test.skip(!hasDatabase, "Requires DATABASE_URL.");
  originalPapers = [];
});

test.afterEach(async () => {
  if (!originalPapers.length) return;

  const sql = database();
  try {
    await sql`delete from profiles where owner_id = ${ownerId}`;
    for (const paper of originalPapers) {
      await sql`
        update papers
        set
          published_at = ${paper.publishedAt},
          ingested_at = ${paper.ingestedAt}
        where id = ${paper.id}::uuid
      `;
    }
  } finally {
    originalPapers = [];
    await sql.end();
  }
});

test("dense digests keep the smallest seven-day window", async ({ page }) => {
  const papers = await seedDigest([1, 2, 6, 10, 12, 15, 20, 25, 29, 40]);

  const response = await page.goto("/digest");
  expect(response?.status()).toBeLessThan(500);
  await expect(page.locator("article")).toHaveCount(3);
  for (const paper of papers.slice(0, 3)) {
    await expect(page.getByRole("heading", { name: paper.title })).toBeVisible();
  }
  await expect(
    page.getByRole("heading", { name: papers[3].title }),
  ).toHaveCount(0);
});

test("sparse digests widen to thirty days with the same selected papers", async ({
  page,
}) => {
  const papers = await seedDigest([1, 10, 20, 22, 25, 28, 29, 31, 40, 45]);

  const response = await page.goto("/digest");
  expect(response?.status()).toBeLessThan(500);
  await expect(page.locator("article")).toHaveCount(7);
  const visibleTitles = await page.locator("article h2").allTextContents();
  expect(visibleTitles.sort()).toEqual(
    papers
      .slice(0, 7)
      .map((paper) => paper.title)
      .sort(),
  );
  await expect(
    page.getByRole("heading", { name: papers[7].title }),
  ).toHaveCount(0);
});
