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
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
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

async function getCurrentProfileEmbeddingSignature(ownerId: string) {
  return withDb(async (sql) => {
    const rows = await sql<{
      current: boolean;
      input_signature: string;
    }[]>`
      select
        e.input_generation = p.embedding_input_generation as current,
        e.input_signature
      from profiles p
      join user_profile_embeddings e on e.owner_id = p.owner_id
      where p.owner_id = ${ownerId}
        and e.embedding_model = 'sentence-transformers/all-MiniLM-L6-v2'
      limit 1
    `;

    if (!rows[0]?.current) return null;
    return JSON.parse(rows[0].input_signature) as {
      papers?: Array<{ id?: string }>;
    };
  });
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

  test("requires an explicit target state for collection mutations", async ({
    request,
  }) => {
    test.skip(!devAuthEnabled, "Requires dev auth.");
    test.skip(!hasDb, "Requires DATABASE_URL.");

    const paperId = await withDb(getSeedPaperId);
    const response = await request.post("/api/deck", {
      data: { action: "favorite", paperId },
    });

    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain("Missing selected state");
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

  test("sets favorite idempotently across ON, OFF, and retry", async ({
    request,
  }) => {
    test.skip(!devAuthEnabled, "Requires dev auth.");
    test.skip(!hasDb, "Requires DATABASE_URL.");

    const paperId = await withDb(getSeedPaperId);
    await withDb(async (sql) => {
      await sql`delete from favorites where owner_id = ${devOwnerId} and paper_id = ${paperId}`;
      await sql`delete from user_paper_interactions where owner_id = ${devOwnerId} and paper_id = ${paperId} and action = 'favorite'`;
    });

    const expectedChanges = [true, false, true, false, true];
    for (const [index, selected] of [true, true, false, false, true].entries()) {
      const response = await request.post("/api/deck", {
        data: { action: "favorite", paperId, selected },
      });
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({
        changed: expectedChanges[index],
        ok: true,
        selected,
      });
    }

    const state = await withDb(async (sql) => sql<{
      favorites: number;
      interactions: number;
    }[]>`
      select
        (select count(*)::int from favorites where owner_id = ${devOwnerId} and paper_id = ${paperId}) as favorites,
        (select count(*)::int from user_paper_interactions where owner_id = ${devOwnerId} and paper_id = ${paperId} and action = 'favorite') as interactions
    `);
    expect(state[0]).toEqual({ favorites: 1, interactions: 2 });
  });

  test("sets Read later idempotently across ON, OFF, and retry", async ({
    request,
  }) => {
    test.skip(!devAuthEnabled, "Requires dev auth.");
    test.skip(!hasDb, "Requires DATABASE_URL.");

    const paperId = await withDb(getSeedPaperId);
    await withDb(async (sql) => {
      await sql`delete from playlist_items where paper_id = ${paperId} and playlist_id in (select id from playlists where owner_id = ${devOwnerId} and name = 'Read later')`;
      await sql`delete from user_paper_interactions where owner_id = ${devOwnerId} and paper_id = ${paperId} and action = 'save_to_playlist'`;
    });

    const expectedChanges = [true, false, true, false, true];
    for (const [index, selected] of [true, true, false, false, true].entries()) {
      const response = await request.post("/api/deck", {
        data: { action: "read_later", paperId, selected },
      });
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({
        changed: expectedChanges[index],
        ok: true,
        selected,
      });
    }

    const state = await withDb(async (sql) => sql<{
      interactions: number;
      read_later: number;
    }[]>`
      select
        (select count(*)::int from playlist_items where paper_id = ${paperId} and playlist_id in (select id from playlists where owner_id = ${devOwnerId} and name = 'Read later')) as read_later,
        (select count(*)::int from user_paper_interactions where owner_id = ${devOwnerId} and paper_id = ${paperId} and action = 'save_to_playlist') as interactions
    `);
    expect(state[0]).toEqual({ interactions: 2, read_later: 1 });
  });

  test("rolls back collection state when interaction recording fails", async ({
    request,
  }) => {
    test.skip(!devAuthEnabled, "Requires dev auth.");
    test.skip(!hasDb, "Requires DATABASE_URL.");

    const paperId = await withDb(getSeedPaperId);
    await withDb(async (sql) => {
      await sql`delete from favorites where owner_id = ${devOwnerId} and paper_id = ${paperId}`;
      await sql`delete from playlist_items where paper_id = ${paperId} and playlist_id in (select id from playlists where owner_id = ${devOwnerId} and name = 'Read later')`;
      await sql`alter table user_paper_interactions drop constraint if exists paperdeck_test_fail_feed_interaction`;
      await sql`alter table user_paper_interactions add constraint paperdeck_test_fail_feed_interaction check (context <> 'feed') not valid`;
    });

    try {
      for (const action of ["favorite", "read_later"]) {
        const response = await request.post("/api/deck", {
          data: { action, paperId, selected: true },
        });
        expect(response.status()).toBe(500);
      }
    } finally {
      await withDb(async (sql) => {
        await sql`alter table user_paper_interactions drop constraint if exists paperdeck_test_fail_feed_interaction`;
      });
    }

    const state = await withDb(async (sql) => sql<{
      favorites: number;
      read_later: number;
    }[]>`
      select
        (select count(*)::int from favorites where owner_id = ${devOwnerId} and paper_id = ${paperId}) as favorites,
        (select count(*)::int from playlist_items where paper_id = ${paperId} and playlist_id in (select id from playlists where owner_id = ${devOwnerId} and name = 'Read later')) as read_later
    `);
    expect(state[0]).toEqual({ favorites: 0, read_later: 0 });
  });
});

test.describe("playlist authorization", () => {
  test.beforeAll(async () => {
    await cleanupTestData();
    await seedTestProfile();
  });

  let createdPlaylistId: string | null = null;
  let pickerPlaylistId: string | null = null;
  let pickerPaperId: string | null = null;
  let pickerPaperTitle: string | null = null;

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

  test("creates and saves through the owner-scoped playlist picker", async ({
    page,
  }) => {
    test.skip(!devAuthEnabled, "Requires dev auth.");
    test.skip(!hasDb, "Requires DATABASE_URL.");

    const paper = await withDb(async (sql) => {
      const paperId = await getSeedPaperId(sql);
      const [row] = await sql<{ id: string; title: string }[]>`
        select id, title from papers where id = ${paperId}::uuid
      `;
      await sql`
        insert into profiles (owner_id, onboarding_completed_at)
        values (${otherOwnerId}, now())
        on conflict (owner_id) do update set onboarding_completed_at = now()
      `;
      await sql`
        insert into playlists (owner_id, name, is_default)
        values
          (${devOwnerId}, 'Read later', true),
          (${otherOwnerId}, 'Other private playlist', false)
        on conflict (owner_id, name) do nothing
      `;
      return row;
    });
    pickerPaperId = paper.id;
    pickerPaperTitle = paper.title;

    await page.goto(`/papers/${paper.id}`);
    await page.getByRole("button", { name: "Save to playlist" }).click();
    const dialog = page.getByRole("dialog", { name: "Save to playlists" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Read later", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Other private playlist")).toHaveCount(0);

    await dialog.getByRole("button", { name: "Create new playlist" }).click();
    await dialog.getByLabel("New playlist name").fill("Picker Playlist");
    await dialog.getByRole("button", { name: "Create and save" }).click();
    await expect(
      dialog.getByRole("checkbox", { name: /Picker Playlist/ }),
    ).toBeChecked();
    const readLaterCheckbox = dialog.getByRole("checkbox", {
      name: /Read later/,
    });
    await readLaterCheckbox.check();
    await expect(readLaterCheckbox).toBeChecked();
    await expect(readLaterCheckbox).toBeEnabled();
    await readLaterCheckbox.uncheck();
    await expect(readLaterCheckbox).not.toBeChecked();
    await expect(readLaterCheckbox).toBeEnabled();
    const customCheckbox = dialog.getByRole("checkbox", {
      name: /Picker Playlist/,
    });
    await expect
      .poll(async () => {
        const signature = await getCurrentProfileEmbeddingSignature(devOwnerId);
        return signature?.papers?.some((input) => input.id === paper.id) ?? false;
      })
      .toBe(true);

    await customCheckbox.uncheck();
    await expect(customCheckbox).not.toBeChecked();
    await expect
      .poll(async () => {
        const signature = await getCurrentProfileEmbeddingSignature(devOwnerId);
        return signature?.papers?.some((input) => input.id === paper.id) ?? false;
      })
      .toBe(false);

    await customCheckbox.check();
    await expect(customCheckbox).toBeChecked();
    await readLaterCheckbox.check();
    await expect(readLaterCheckbox).toBeChecked();

    await expect
      .poll(() =>
        withDb(async (sql) => {
          const [row] = await sql<{ count: number }[]>`
            select count(*)::integer as count
            from playlist_items pi
            join playlists p on p.id = pi.playlist_id
            where p.owner_id = ${devOwnerId}
              and pi.paper_id = ${paper.id}::uuid
          `;
          return row.count;
        }),
      )
      .toBe(2);

    const created = await withDb(async (sql) => {
      const rows = await sql<{ id: string }[]>`
        select p.id
        from playlists p
        join playlist_items pi on pi.playlist_id = p.id
        where p.owner_id = ${devOwnerId}
          and p.name = 'Picker Playlist'
          and pi.paper_id = ${paper.id}::uuid
      `;
      const interactions = await sql<{ count: number }[]>`
        select count(*)::integer as count
        from user_paper_interactions
        where owner_id = ${devOwnerId}
          and paper_id = ${paper.id}::uuid
          and action = 'save_to_playlist'
      `;
      expect(interactions[0].count).toBe(4);
      return rows[0] ?? null;
    });
    expect(created).not.toBeNull();
    pickerPlaylistId = created!.id;

    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("uses explicit playlist editing and opens the whole paper row", async ({
    page,
  }) => {
    test.skip(!devAuthEnabled, "Requires dev auth.");
    test.skip(!hasDb, "Requires DATABASE_URL.");
    test.skip(
      !pickerPlaylistId || !pickerPaperId || !pickerPaperTitle,
      "Picker setup is required.",
    );

    await withDb(async (sql) => {
      await sql`
        insert into favorites (owner_id, paper_id)
        values (${devOwnerId}, ${pickerPaperId}::uuid)
        on conflict (owner_id, paper_id) do nothing
      `;
    });

    await page.goto("/library");
    await expect(page).toHaveURL(/\/library$/);
    await expect(
      page.getByRole("heading", { name: "Read later", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit Read later" }),
    ).toBeVisible();
    await expect(
      page.getByText("My playlists", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: `Open ${pickerPaperTitle}` })
      .click();
    await expect(page).toHaveURL(new RegExp(`/papers/${pickerPaperId}$`));
    const backgroundReload = page.waitForResponse(
      (response) =>
        response.url().includes("/api/library/collections") && response.ok(),
    );
    await page.goBack();
    await backgroundReload;

    await page.getByRole("button", { name: "Edit Read later" }).click();
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Drag to reorder" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/library$/);
    await page
      .getByRole("button", { name: "Stop editing Read later" })
      .click();
    await expect(page.getByText("Editing", { exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(/\/library$/);

    await page.getByRole("button", { name: "Edit Read later" }).click();
    let libraryNavigationRequests = 0;
    const countLibraryNavigation = (request: { url(): string }) => {
      if (request.url().includes("/library?view=favorites")) {
        libraryNavigationRequests += 1;
      }
    };
    page.on("request", countLibraryNavigation);
    await page.evaluate(() => {
      const browserWindow = window as typeof window & {
        __paperdeckLibraryTransition?: {
          observer: MutationObserver;
          states: Array<{ editing: boolean; heading: string }>;
        };
      };
      const states: Array<{ editing: boolean; heading: string }> = [];
      const record = () => {
        states.push({
          editing: Boolean(
            document.querySelector(
              'button[aria-label="Stop editing Favorites"]',
            ),
          ),
          heading:
            document.querySelector("#library-collection-title")?.textContent ??
            "",
        });
      };
      const observer = new MutationObserver(record);
      observer.observe(document.body, { childList: true, subtree: true });
      browserWindow.__paperdeckLibraryTransition = { observer, states };
    });
    await page.getByRole("button", { name: "Edit Favorites" }).click();
    await expect(page).toHaveURL(/\/library\?view=favorites$/);
    await expect(
      page.getByRole("heading", { name: "Favorites", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Stop editing Favorites" }),
    ).toBeVisible();
    const transitionStates = await page.evaluate(() => {
      const browserWindow = window as typeof window & {
        __paperdeckLibraryTransition?: {
          observer: MutationObserver;
          states: Array<{ editing: boolean; heading: string }>;
        };
      };
      const transition = browserWindow.__paperdeckLibraryTransition;
      transition?.observer.disconnect();
      delete browserWindow.__paperdeckLibraryTransition;
      return transition?.states ?? [];
    });
    page.off("request", countLibraryNavigation);
    expect(libraryNavigationRequests).toBe(0);
    expect(
      transitionStates
        .filter((state) => state.heading === "Favorites")
        .every((state) => state.editing),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Stop editing Favorites" })
      .click();
    await expect(
      page.getByRole("link", { name: `Open ${pickerPaperTitle}` }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Edit Picker Playlist" })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/library\\?playlist=${pickerPlaylistId}$`),
    );
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Stop editing Picker Playlist" })
      .click();
    await expect(page.getByText("Editing", { exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(
      new RegExp(`/library\\?playlist=${pickerPlaylistId}$`),
    );

    await page.locator(`a[href="/papers/${pickerPaperId}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/papers/${pickerPaperId}$`));
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

  test("browser back advances past a paper opened from the deck", async ({
    page,
  }) => {
    test.skip(!devAuthEnabled, "Requires dev auth.");
    test.skip(!hasDb, "Requires DATABASE_URL.");

    const response = await page.goto("/feed");

    expect(response?.status()).toBeLessThan(500);
    const openLink = page.getByRole("link", { name: "Open" });
    const openedPaperHref = await openLink.getAttribute("href");

    expect(openedPaperHref).toMatch(/^\/papers\//);
    await openLink.click();
    await expect(page).toHaveURL(new RegExp(`${openedPaperHref}$`));
    await page.goBack();
    await expect(page).toHaveURL(/\/feed$/);
    await expect(page.getByRole("link", { name: "Open" })).not.toHaveAttribute(
      "href",
      openedPaperHref!,
    );
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
        selected: true,
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
