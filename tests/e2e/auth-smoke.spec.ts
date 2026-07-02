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
    for (const path of ["/feed", "/onboarding"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/sign-in/);
    }
  });
});
