import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { isDevAuthEnabled } from "@/lib/auth/dev-auth";
import {
  privateNoStoreHeaders,
  shouldUsePrivateNoStore,
} from "@/lib/security/route-cache-policy";

const authorizedParties = process.env.CLERK_AUTHORIZED_PARTIES?.split(",")
  .map((party) => party.trim())
  .filter(Boolean);

const clerkRequestMiddleware = clerkMiddleware(
  authorizedParties?.length ? { authorizedParties } : undefined,
);

function applyCachePolicy(response: Response, request: NextRequest) {
  if (
    shouldUsePrivateNoStore({
      pathname: request.nextUrl.pathname,
      method: request.method,
    })
  ) {
    for (const header of privateNoStoreHeaders()) {
      response.headers.set(header.key, header.value);
    }
  }

  return response;
}

export default async function proxy(
  request: NextRequest,
  event: NextFetchEvent,
) {
  if (
    process.env.PAPERDECK_CLERK_CACHE_SMOKE === "true" &&
    /^\/sign-(?:in|up)(?:\/|$)/.test(request.nextUrl.pathname)
  ) {
    return applyCachePolicy(NextResponse.next(), request);
  }

  const response = isDevAuthEnabled()
    ? NextResponse.next()
    : await clerkRequestMiddleware(request, event);

  return applyCachePolicy(response ?? NextResponse.next(), request);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
