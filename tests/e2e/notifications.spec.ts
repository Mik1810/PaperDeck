import { expect, test } from "@playwright/test";

test("notification history and responsive dialog remain accessible", async ({
  page,
}) => {
  await page.goto("/notifications", { waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("heading", { level: 1, name: "Notifications" }),
  ).toBeVisible();
  await expect(page.getByText("No notifications here")).toBeVisible();

  const bell = page.getByRole("button", { name: /^Notifications/ });
  await bell.click();
  const dialog = page.getByRole("dialog", { name: "Notifications" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("0 unread")).toBeVisible();

  const withinViewport = await dialog.evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    return (
      rectangle.left >= 0 &&
      rectangle.top >= 0 &&
      rectangle.right <= window.innerWidth &&
      rectangle.bottom <= window.innerHeight
    );
  });
  expect(withinViewport).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(bell).toBeFocused();
});
