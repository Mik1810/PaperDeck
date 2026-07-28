import { createClerkClient } from "@clerk/backend";
import { clerk } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const emailA = process.env.PAPERDECK_RLS_USER_A_EMAIL;
const emailB = process.env.PAPERDECK_RLS_USER_B_EMAIL;
const clerkSecretKey = process.env.CLERK_SECRET_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function requireTestConfiguration() {
  if (
    !emailA ||
    !emailB ||
    !clerkSecretKey ||
    !supabaseUrl ||
    !supabaseServiceRoleKey
  ) {
    throw new Error(
      "Clerk cache smoke requires Clerk test users and server-only Supabase cleanup configuration",
    );
  }
  if (emailA === emailB) {
    throw new Error("Clerk cache smoke requires two distinct test users");
  }
  return {
    emailA,
    emailB,
    clerkSecretKey,
    supabaseUrl,
    supabaseServiceRoleKey,
  };
}

async function signInTracked(
  page: Page,
  emailAddress: string,
  sessionIds: Set<string>,
) {
  await page.goto("/sign-in");
  await clerk.signIn({ page, emailAddress });
  await clerk.loaded({ page });
  const sessionId = await page.evaluate(() => window.Clerk.session?.id ?? null);
  if (!sessionId) {
    throw new Error("Clerk sign-in did not create an active session");
  }
  sessionIds.add(sessionId);
  return sessionId;
}

async function signOutTracked(
  page: Page,
  sessionId: string | null,
  sessionIds: Set<string>,
) {
  if (!sessionId) return;
  await clerk.signOut({
    page,
    signOutOptions: { redirectUrl: "/sign-in" },
  });
  sessionIds.delete(sessionId);
}

async function openLibrary(page: Page) {
  const response = await page.goto("/library", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBeLessThan(500);
  await expect(
    page.getByRole("heading", { exact: true, name: "Library" }),
  ).toBeVisible();
  return response;
}

test("user A data is absent after logout and user B sign-in", async ({
  page,
}) => {
  const config = requireTestConfiguration();
  const backend = createClerkClient({ secretKey: config.clerkSecretKey });
  const supabase = createClient(
    config.supabaseUrl,
    config.supabaseServiceRoleKey,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
  const startedAt = Date.now();
  const marker = `cache-isolation-${Date.now()}`;
  const sessionIds = new Set<string>();
  const baselineSessionIds = new Set<string>();
  const testUserIds: string[] = [];
  const cleanupFailures: string[] = [];
  let activeSessionId: string | null = null;
  let markerMayExist = false;
  let ownerAId: string | null = null;

  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(20_000);

  const { data: users } = await backend.users.getUserList({
    emailAddress: [config.emailA, config.emailB],
    limit: 10,
  });
  for (const email of [config.emailA, config.emailB]) {
    const user = users.find((candidate) =>
      candidate.emailAddresses.some(
        ({ emailAddress }) => emailAddress === email,
      ),
    );
    if (!user) {
      throw new Error("A configured Clerk cache-smoke user was not found");
    }
    testUserIds.push(user.id);
    if (email === config.emailA) {
      ownerAId = user.id;
    }
    const activeSessions = await backend.sessions.getSessionList({
      userId: user.id,
      status: "active",
      limit: 100,
    });
    for (const session of activeSessions.data) {
      baselineSessionIds.add(session.id);
    }
  }

  try {
    activeSessionId = await signInTracked(page, config.emailA, sessionIds);
    await openLibrary(page);

    await page.getByRole("button", { name: "Create playlist" }).click();
    await page.getByPlaceholder("Playlist name").fill(marker);
    markerMayExist = true;
    await page.getByRole("button", { exact: true, name: "Create" }).click();
    await expect(
      page.getByRole("link", { exact: true, name: marker }),
    ).toBeVisible();

    await signOutTracked(page, activeSessionId, sessionIds);
    activeSessionId = null;
    activeSessionId = await signInTracked(page, config.emailB, sessionIds);

    const libraryResponse = await openLibrary(page);
    expect(await libraryResponse!.text()).not.toContain(marker);
    await expect(page.getByText(marker, { exact: true })).toHaveCount(0);

    const rscBody = await page.evaluate(async (url) => {
      const response = await fetch(url, { headers: { RSC: "1" } });
      return response.text();
    }, `/library?_rsc=cache-isolation-${Date.now()}`);
    expect(rscBody).not.toContain(marker);

    const apiBody = await page.evaluate(async () => {
      const response = await fetch("/api/deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      return response.text();
    });
    expect(apiBody).not.toContain(marker);

    const cacheSnapshot = await page.evaluate(async (privateMarker) => {
      const urls: string[] = [];
      let containsMarker = false;

      for (const cacheName of await caches.keys()) {
        const cache = await caches.open(cacheName);
        for (const request of await cache.keys()) {
          const url = new URL(request.url);
          urls.push(url.pathname + url.search);
          const response = await cache.match(request);
          if (response && (await response.clone().text()).includes(privateMarker)) {
            containsMarker = true;
          }
        }
      }

      return { containsMarker, urls };
    }, marker);
    expect(cacheSnapshot.containsMarker).toBe(false);
    expect(cacheSnapshot.urls.some((url) => url.startsWith("/library"))).toBe(
      false,
    );

    for (let index = 0; index < 5; index += 1) {
      const previousUrl = page.url();
      const navigation = await page
        .goBack({ waitUntil: "domcontentloaded", timeout: 10_000 })
        .catch(() => null);
      await expect(page.getByText(marker, { exact: true })).toHaveCount(0);
      if (!navigation && page.url() === previousUrl) break;
    }
  } finally {
    try {
      await signOutTracked(page, activeSessionId, sessionIds);
      activeSessionId = null;
    } catch {
      // Backend cleanup below revokes this tracked session if browser logout stalls.
    }

    if (markerMayExist) {
      try {
        if (!ownerAId) {
          throw new Error("Test user A owner id was not resolved");
        }
        const markerRows = await supabase
          .from("playlists")
          .select("id")
          .eq("owner_id", ownerAId)
          .eq("name", marker)
          .eq("is_default", false);
        if (markerRows.error || markerRows.data.length > 1) {
          throw new Error("Temporary playlist lookup was not exact");
        }
        if (markerRows.data.length === 1) {
          const deletion = await supabase
            .from("playlists")
            .delete()
            .eq("id", markerRows.data[0].id)
            .eq("owner_id", ownerAId)
            .eq("name", marker)
            .select("id");
          if (deletion.error || deletion.data.length !== 1) {
            throw new Error("Temporary playlist deletion failed");
          }
        }
        markerMayExist = false;
      } catch {
        cleanupFailures.push("temporary playlist");
      }
    }

    try {
      for (const userId of testUserIds) {
        const activeSessions = await backend.sessions.getSessionList({
          userId,
          status: "active",
          limit: 100,
        });
        for (const session of activeSessions.data) {
          if (
            !baselineSessionIds.has(session.id) &&
            session.createdAt >= startedAt - 1_000
          ) {
            sessionIds.add(session.id);
          }
        }
      }
    } catch {
      cleanupFailures.push("tracked Clerk sessions");
    }

    const revocations = await Promise.allSettled(
      [...sessionIds].map((sessionId) =>
        backend.sessions.revokeSession(sessionId),
      ),
    );
    if (revocations.some((result) => result.status === "rejected")) {
      cleanupFailures.push("tracked Clerk sessions");
    }

    expect(
      cleanupFailures,
      `Cleanup failed for: ${cleanupFailures.join(", ")}`,
    ).toEqual([]);
  }
});
