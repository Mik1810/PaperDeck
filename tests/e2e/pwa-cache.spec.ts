import { expect, test } from "@playwright/test";

test.describe("PWA cache policy", () => {
  test("keeps authenticated navigations out of Cache Storage", async ({
    context,
    page,
  }) => {
    await page.goto("/offline.html");

    await page.evaluate(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations.map((registration) => registration.unregister()),
      );

      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    });

    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });

      await new Promise<void>((resolve) => {
        const worker =
          registration.installing || registration.waiting || registration.active;

        if (!worker || worker.state === "activated") {
          resolve();
          return;
        }

        worker.addEventListener("statechange", () => {
          if (worker.state === "activated") {
            resolve();
          }
        });
      });

      await navigator.serviceWorker.ready;
    });

    if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
      await page.reload();
    }

    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);

    const navigationCacheCheck = `/offline.html?nav-cache-check=${Date.now()}`;
    await page.goto(navigationCacheCheck);

    const cachedUrls = await page.evaluate(async () => {
      const urls: string[] = [];

      for (const cacheName of await caches.keys()) {
        const cache = await caches.open(cacheName);
        const requests = await cache.keys();
        urls.push(
          ...requests.map((request) => {
            const url = new URL(request.url);
            return url.pathname + url.search;
          }),
        );
      }

      return urls;
    });

    expect(cachedUrls).toContain("/offline.html");
    expect(cachedUrls).not.toContain("/feed");
    expect(cachedUrls).not.toContain(navigationCacheCheck);

    await context.setOffline(true);
    await page.goto(`/feed?offline-check=${Date.now()}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(
      page.getByRole("heading", { name: "You're offline" }),
    ).toBeVisible();
  });
});
