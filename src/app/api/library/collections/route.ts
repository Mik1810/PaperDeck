import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { requireOwnerId } from "@/lib/auth/session";
import { isLibraryCollectionKey } from "@/lib/library-collections";
import { InvalidLibraryCursorError } from "@/lib/repositories/library-cursor";
import { getLibraryCollectionPage } from "@/lib/repositories/user-data";
import { privateNoStoreHeaders } from "@/lib/security/route-cache-policy";

export const dynamic = "force-dynamic";

function responseHeaders() {
  return Object.fromEntries(
    privateNoStoreHeaders().map((header) => [header.key, header.value]),
  );
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const collectionKey = searchParams.get("collection") ?? "";
    const cursor = searchParams.get("cursor");

    if (!isLibraryCollectionKey(collectionKey)) {
      return NextResponse.json(
        { error: "A valid Library collection is required." },
        { status: 400, headers: responseHeaders() },
      );
    }

    const ownerId = await requireOwnerId();
    const data = await getLibraryCollectionPage(
      ownerId,
      collectionKey,
      cursor,
    );
    return NextResponse.json(data, { headers: responseHeaders() });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof InvalidLibraryCursorError) {
      return NextResponse.json(
        { error: "The Library pagination cursor is invalid." },
        { status: 400, headers: responseHeaders() },
      );
    }
    return NextResponse.json(
      { error: "Library collections are unavailable." },
      { status: 500, headers: responseHeaders() },
    );
  }
}
