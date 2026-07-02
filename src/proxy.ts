import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { isDevAuthEnabled } from "@/lib/auth/dev-auth";

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

const clerkProtectedRoutes = clerkMiddleware(async (auth, request) => {
  if (isProtectedRoute(request)) {
    await auth.protect();
  }
}, authorizedParties?.length ? { authorizedParties } : undefined);

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (isDevAuthEnabled()) {
    return NextResponse.next();
  }

  return clerkProtectedRoutes(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
