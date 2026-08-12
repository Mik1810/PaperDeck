import { expect, test } from "@playwright/test";

const clerkAuthEnabled = process.env.PAPERDECK_E2E_DEV_AUTH === "false";

test.describe("Clerk auth smoke", () => {
  test.skip(
    !clerkAuthEnabled,
    "Set PAPERDECK_E2E_DEV_AUTH=false to smoke test real Clerk redirects.",
  );

  test("sign-in page renders", async ({ page }) => {
    const response = await page.goto("/sign-in");

    expect(response?.status()).toBeLessThan(500);
    await expect(
      page.getByRole("heading", { name: "Sign in to PaperDeck" }),
    ).toBeVisible();
  });

  test("unauthenticated protected pages land on sign-in", async ({ page }) => {
    for (const path of [
      "/",
      "/feed",
      "/digest",
      "/library",
      "/onboarding",
      "/papers/not-a-paper",
      "/search",
      "/settings",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/sign-in/);
    }
  });

  test("unauthenticated RSC and mutation requests are rejected", async ({
    request,
  }) => {
    const rsc = await request.get("/feed", {
      headers: { RSC: "1" },
      maxRedirects: 0,
    });
    expect(await rsc.text()).toContain("NEXT_REDIRECT");

    for (const path of [
      "/api/deck",
      "/api/recommendation-impressions",
      "/papers/not-a-paper/feedback",
    ]) {
      const response = await request.post(path, {
        data: {},
        maxRedirects: 0,
      });
      expect(response.status()).toBe(307);
      expect(response.headers().location).toContain("/sign-in");
    }
  });
});
