import { expect, test } from "@playwright/test";

const PRIVATE_NO_STORE =
  "private, no-store, max-age=0, must-revalidate";
const NEXT_DEV_NO_CACHE = "no-cache, must-revalidate";

function expectPrivateNoStoreHeaders(headers: Record<string, string>) {
  expect([PRIVATE_NO_STORE, NEXT_DEV_NO_CACHE]).toContain(
    headers["cache-control"],
  );
  expect(headers["cdn-cache-control"]).toBe("no-store");
  expect(headers["vercel-cdn-cache-control"]).toBe("no-store");
}

test.describe("authenticated response cache policy", () => {
  test("marks personalized HTML and RSC responses private no-store", async ({
    request,
  }) => {
    const htmlResponse = await request.get("/feed", {
      maxRedirects: 0,
    });
    const rscResponse = await request.get(
      `/feed?_rsc=cache-policy-${Date.now()}`,
      {
        headers: { RSC: "1" },
        maxRedirects: 0,
      },
    );

    expectPrivateNoStoreHeaders(htmlResponse.headers());
    expectPrivateNoStoreHeaders(rscResponse.headers());
  });

  test("marks authenticated mutations private no-store", async ({ request }) => {
    const response = await request.post("/api/deck", {
      data: {},
      maxRedirects: 0,
    });

    expectPrivateNoStoreHeaders(response.headers());
  });

  test("keeps notification HTML and API responses private no-store", async ({
    request,
  }) => {
    const [htmlResponse, apiResponse] = await Promise.all([
      request.get("/notifications", { maxRedirects: 0 }),
      request.get("/api/notifications?limit=1", { maxRedirects: 0 }),
    ]);

    expectPrivateNoStoreHeaders(htmlResponse.headers());
    expectPrivateNoStoreHeaders(apiResponse.headers());
  });

  test("does not force private caching onto explicit public assets", async ({
    request,
  }) => {
    const response = await request.get("/manifest.json");

    expect(response.ok()).toBe(true);
    expect(response.headers()["cache-control"]).not.toBe(PRIVATE_NO_STORE);
  });
});
