import "server-only";

import { createHash } from "node:crypto";

export const SEARCH_PAGE_SIZE = 20;

export type CatalogSearchCursorDirection = "next" | "previous";

export type CatalogSearchCursor = {
  direction: CatalogSearchCursorDirection;
  id: string;
  page: number;
  queryHash: string;
  rank: number;
  version: 1;
  year: number | null;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const queryHashPattern = /^[0-9a-f]{32}$/;

export class InvalidCatalogSearchCursorError extends Error {
  constructor() {
    super("Invalid catalog-search pagination cursor");
    this.name = "InvalidCatalogSearchCursorError";
  }
}

function queryHash(query: string) {
  return createHash("sha256").update(query).digest("hex").slice(0, 32);
}

export function encodeCatalogSearchCursor(
  boundary: Omit<CatalogSearchCursor, "queryHash" | "version">,
  query: string,
) {
  const cursor: CatalogSearchCursor = {
    ...boundary,
    queryHash: queryHash(query),
    version: 1,
  };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCatalogSearchCursor(
  value: string | null | undefined,
  query: string,
): CatalogSearchCursor | null {
  if (!value) return null;
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new InvalidCatalogSearchCursorError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new InvalidCatalogSearchCursorError();
  }

  if (!parsed || typeof parsed !== "object") {
    throw new InvalidCatalogSearchCursorError();
  }

  const candidate = parsed as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    (candidate.direction !== "next" && candidate.direction !== "previous") ||
    typeof candidate.id !== "string" ||
    !uuidPattern.test(candidate.id) ||
    typeof candidate.page !== "number" ||
    !Number.isSafeInteger(candidate.page) ||
    candidate.page < 1 ||
    typeof candidate.queryHash !== "string" ||
    !queryHashPattern.test(candidate.queryHash) ||
    candidate.queryHash !== queryHash(query) ||
    typeof candidate.rank !== "number" ||
    !Number.isFinite(candidate.rank) ||
    !(
      candidate.year === null ||
      (typeof candidate.year === "number" &&
        Number.isSafeInteger(candidate.year) &&
        candidate.year >= 0)
    )
  ) {
    throw new InvalidCatalogSearchCursorError();
  }

  return candidate as CatalogSearchCursor;
}
