import { expect, test } from "@playwright/test";

test.describe("PWA cache policy", () => {
  test("does not announce the first service worker install as an update", async ({
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
    await page.close();

    const firstVisit = await context.newPage();
    await firstVisit.setViewportSize({ width: 390, height: 844 });
    await firstVisit.goto(`/pwa-install-check-${Date.now()}`, {
      waitUntil: "domcontentloaded",
    });

    await expect
      .poll(() =>
        firstVisit.evaluate(async () => {
          const registrations =
            await navigator.serviceWorker.getRegistrations();
          return (
            registrations.length === 1 &&
            Boolean(navigator.serviceWorker.controller)
          );
        }),
      )
      .toBe(true);

    await expect(
      firstVisit.getByRole("region", { name: "App update" }),
    ).toHaveCount(0);
  });

  test("keeps dynamic navigations out of Cache Storage", async ({
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

    const navigationCacheCheck = `/pwa-navigation-check-${Date.now()}`;
    await page.goto(navigationCacheCheck, {
      waitUntil: "domcontentloaded",
    });

    const secondNavigationCacheCheck = `/pwa-navigation-check-secondary-${Date.now()}`;
    await page.goto(secondNavigationCacheCheck, {
      waitUntil: "domcontentloaded",
    });

    const rscCacheCheck = `/pwa-rsc-check-${Date.now()}?_rsc=cache-check`;
    await page.evaluate(async (url) => {
      await fetch(url, {
        headers: { RSC: "1" },
      });
    }, rscCacheCheck);

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
    expect(cachedUrls).toContain("/apple-touch-icon.png");
    expect(cachedUrls).not.toContain(navigationCacheCheck);
    expect(cachedUrls).not.toContain(secondNavigationCacheCheck);
    expect(cachedUrls).not.toContain(rscCacheCheck);

    await context.setOffline(true);
    await page.goto(`/pwa-offline-check-${Date.now()}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(
      page.getByRole("heading", { name: "You're offline" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.locator("img.offline-icon").evaluate((image) =>
          image instanceof HTMLImageElement ? image.naturalWidth : 0,
        ),
      )
      .toBeGreaterThan(0);
  });
});
