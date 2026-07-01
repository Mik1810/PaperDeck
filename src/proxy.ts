import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const authorizedParties = process.env.CLERK_AUTHORIZED_PARTIES?.split(",")
  .map((party) => party.trim())
  .filter(Boolean);

const isProtectedRoute = createRouteMatcher([
  "/feed(.*)",
  "/library(.*)",
  "/onboarding(.*)",
  "/papers(.*)",
  "/settings(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (isProtectedRoute(request)) {
    await auth.protect();
  }
}, authorizedParties?.length ? { authorizedParties } : undefined);

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
