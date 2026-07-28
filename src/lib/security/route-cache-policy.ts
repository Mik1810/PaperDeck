export const PRIVATE_NO_STORE_CACHE_CONTROL =
  "private, no-store, max-age=0, must-revalidate";
export const PRIVATE_CDN_CACHE_CONTROL = "no-store";

export const PRIVATE_CACHE_HEADER_SOURCES = [
  "/",
  "/feed/:path*",
  "/digest/:path*",
  "/library/:path*",
  "/onboarding/:path*",
  "/papers/:path*",
  "/search/:path*",
  "/settings/:path*",
  "/sign-in/:path*",
  "/sign-up/:path*",
  "/api/:path*",
  "/__clerk/:path*",
] as const;

export type RouteCacheClass =
  | "public-static"
  | "auth-entry"
  | "personalized"
  | "mutation"
  | "webhook"
  | "dynamic";

type RouteRequest = {
  pathname: string;
  method?: string;
};

const publicStaticPaths = [
  /^\/offline\.html$/,
  /^\/manifest\.json$/,
  /^\/sw\.js$/,
  /^\/favicon\.ico$/,
  /^\/apple-touch-icon\.png$/,
  /^\/(?:icon|splash)-[^/]+$/,
  /^\/_next\/static\//,
];

const authEntryPaths = [
  /^\/sign-in(?:\/|$)/,
  /^\/sign-up(?:\/|$)/,
  /^\/__clerk(?:\/|$)/,
];

const personalizedPaths = [
  /^\/$/,
  /^\/feed(?:\/|$)/,
  /^\/digest(?:\/|$)/,
  /^\/library(?:\/|$)/,
  /^\/onboarding(?:\/|$)/,
  /^\/papers(?:\/|$)/,
  /^\/search(?:\/|$)/,
  /^\/settings(?:\/|$)/,
];

export function classifyRouteCache({
  pathname,
  method = "GET",
}: RouteRequest): RouteCacheClass {
  if (publicStaticPaths.some((pattern) => pattern.test(pathname))) {
    return "public-static";
  }

  if (/^\/api\/webhooks\/clerk(?:\/|$)/.test(pathname)) {
    return "webhook";
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
    return "mutation";
  }

  if (authEntryPaths.some((pattern) => pattern.test(pathname))) {
    return "auth-entry";
  }

  if (personalizedPaths.some((pattern) => pattern.test(pathname))) {
    return "personalized";
  }

  return "dynamic";
}

export function shouldUsePrivateNoStore(request: RouteRequest) {
  return classifyRouteCache(request) !== "public-static";
}

export function privateNoStoreHeaders() {
  return [
    {
      key: "Cache-Control",
      value: PRIVATE_NO_STORE_CACHE_CONTROL,
    },
    {
      key: "CDN-Cache-Control",
      value: PRIVATE_CDN_CACHE_CONTROL,
    },
    {
      key: "Vercel-CDN-Cache-Control",
      value: PRIVATE_CDN_CACHE_CONTROL,
    },
  ] as const;
}
