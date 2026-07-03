import { expect, test, type Page } from "@playwright/test";

const devAuthEnabled = process.env.PAPERDECK_E2E_DEV_AUTH !== "false";

function hasConfiguredEnv(name: string) {
  const value = process.env[name];

  return Boolean(
    value &&
      value !== "replace_me" &&
      value !== "dummy" &&
      !value.includes("replace-me"),
  );
}

const hasSupabaseEnv =
  hasConfiguredEnv("NEXT_PUBLIC_SUPABASE_URL") &&
  hasConfiguredEnv("SUPABASE_SERVICE_ROLE_KEY");

async function completeDevOnboarding(page: Page) {
  const response = await page.goto("/onboarding");

  expect(response?.status()).toBeLessThan(500);
  await expect(
    page.getByRole("heading", { exact: true, name: "Macro areas" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).click();
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

  test("root redirects to onboarding", async ({ request }) => {
    const response = await request.get("/", { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    expect(response.headers().location).toContain("/onboarding");
  });

  for (const { path, heading } of [
    { path: "/feed", heading: "Today" },
    { path: "/onboarding", heading: "Macro areas" },
    { path: "/library", heading: "Library" },
    { path: "/settings", heading: "Settings" },
  ]) {
    test(`${path} renders without a server error`, async ({ page }) => {
      test.skip(
        !hasSupabaseEnv,
        "Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      );

      if (path !== "/onboarding") {
        await completeDevOnboarding(page);
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
