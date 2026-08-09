import assert from "node:assert/strict";
import test from "node:test";
import {
  PRIVATE_CACHE_HEADER_SOURCES,
  PRIVATE_CDN_CACHE_CONTROL,
  PRIVATE_NO_STORE_CACHE_CONTROL,
  classifyRouteCache,
  privateNoStoreHeaders,
  shouldUsePrivateNoStore,
} from "../../src/lib/security/route-cache-policy";

test("classifies every personalized page as private", () => {
  for (const pathname of [
    "/",
    "/feed",
    "/digest",
    "/library",
    "/onboarding",
    "/notifications",
    "/groups",
    "/groups/group-id",
    "/papers/paper-id",
    "/search",
    "/settings",
  ]) {
    assert.equal(classifyRouteCache({ pathname }), "personalized", pathname);
    assert.equal(shouldUsePrivateNoStore({ pathname }), true, pathname);
  }
});

test("classifies sign-in and Clerk frontend routes as auth-sensitive", () => {
  for (const pathname of ["/sign-in", "/sign-up/verify", "/__clerk/v1/client"]) {
    assert.equal(classifyRouteCache({ pathname }), "auth-entry", pathname);
    assert.equal(shouldUsePrivateNoStore({ pathname }), true, pathname);
  }
});

test("classifies mutations and the Clerk webhook as no-store", () => {
  assert.equal(
    classifyRouteCache({ pathname: "/api/deck", method: "POST" }),
    "mutation",
  );
  assert.equal(
    classifyRouteCache({
      pathname: "/api/webhooks/clerk",
      method: "POST",
    }),
    "webhook",
  );
  assert.equal(
    classifyRouteCache({
      pathname: "/papers/paper-id/feedback",
      method: "POST",
    }),
    "mutation",
  );
});

test("leaves only explicit public static resources cacheable", () => {
  for (const pathname of [
    "/offline.html",
    "/manifest.json",
    "/sw.js",
    "/favicon.ico",
    "/apple-touch-icon.png",
    "/icon-192.png",
    "/splash-1170x2532.png",
    "/_next/static/chunks/app.js",
  ]) {
    assert.equal(classifyRouteCache({ pathname }), "public-static", pathname);
    assert.equal(shouldUsePrivateNoStore({ pathname }), false, pathname);
  }
});

test("defaults unknown dynamic routes to private no-store", () => {
  assert.equal(classifyRouteCache({ pathname: "/future-route" }), "dynamic");
  assert.equal(shouldUsePrivateNoStore({ pathname: "/future-route" }), true);
});

test("uses an explicit private no-store directive", () => {
  assert.equal(
    PRIVATE_NO_STORE_CACHE_CONTROL,
    "private, no-store, max-age=0, must-revalidate",
  );
  assert.equal(PRIVATE_CDN_CACHE_CONTROL, "no-store");
  assert.deepEqual(privateNoStoreHeaders(), [
    {
      key: "Cache-Control",
      value: "private, no-store, max-age=0, must-revalidate",
    },
    {
      key: "CDN-Cache-Control",
      value: "no-store",
    },
    {
      key: "Vercel-CDN-Cache-Control",
      value: "no-store",
    },
  ]);
});

test("exports Next.js header sources for every sensitive route family", () => {
  assert.deepEqual(PRIVATE_CACHE_HEADER_SOURCES, [
    "/",
    "/feed/:path*",
    "/digest/:path*",
    "/library/:path*",
    "/onboarding/:path*",
    "/notifications/:path*",
    "/groups/:path*",
    "/papers/:path*",
    "/search/:path*",
    "/settings/:path*",
    "/sign-in/:path*",
    "/sign-up/:path*",
    "/api/:path*",
    "/__clerk/:path*",
  ]);
});
