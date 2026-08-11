import { expect, test } from "@playwright/test";

function notificationRequestView(url: string) {
  const parsed = new URL(url);
  if (parsed.pathname !== "/api/notifications") return null;
  return parsed.searchParams.get("view") === "count" ? "count" : "list";
}

test("notification center defers list loading and coalesces lifecycle refreshes", async ({
  page,
}) => {
  const requestViews: Array<"count" | "list"> = [];
  page.on("request", (request) => {
    const view = notificationRequestView(request.url());
    if (view) requestViews.push(view);
  });

  const initialCountResponse = page.waitForResponse(
    (response) =>
      notificationRequestView(response.url()) === "count" && response.ok(),
  );
  await page.goto("/notifications", { waitUntil: "domcontentloaded" });
  const countResponse = await initialCountResponse;
  expect(await countResponse.json()).toEqual({
    unreadCount: expect.any(Number),
  });

  await page.waitForTimeout(1_100);
  expect(requestViews).not.toContain("list");
  requestViews.length = 0;

  const lifecycleResponse = page.waitForResponse(
    (response) =>
      notificationRequestView(response.url()) === "count" && response.ok(),
  );
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
  });
  await lifecycleResponse;
  await page.waitForTimeout(500);
  expect(requestViews).toEqual(["count"]);

  const bell = page.getByRole("button", { name: /^Notifications/ });
  const listResponse = page.waitForResponse(
    (response) =>
      notificationRequestView(response.url()) === "list" && response.ok(),
  );
  await bell.click();
  await listResponse;
  await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(requestViews.filter((view) => view === "list")).toHaveLength(1);
});

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
