import "server-only";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LibraryCursor =
  | {
      paperId: string;
      position: number;
      sort: "playlist";
      timestamp: string;
      version: 1;
    }
  | {
      paperId: string;
      sort: "favorites" | "ignored";
      timestamp: string;
      version: 1;
    };

export class InvalidLibraryCursorError extends Error {
  constructor() {
    super("Invalid Library pagination cursor");
    this.name = "InvalidLibraryCursorError";
  }
}

export function encodeLibraryCursor(cursor: LibraryCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeLibraryCursor(
  value: string | null | undefined,
  expectedSort: LibraryCursor["sort"],
): LibraryCursor | null {
  if (!value) return null;
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new InvalidLibraryCursorError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new InvalidLibraryCursorError();
  }

  if (!parsed || typeof parsed !== "object") {
    throw new InvalidLibraryCursorError();
  }

  const candidate = parsed as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    candidate.sort !== expectedSort ||
    typeof candidate.paperId !== "string" ||
    !uuidPattern.test(candidate.paperId) ||
    typeof candidate.timestamp !== "string" ||
    !Number.isFinite(Date.parse(candidate.timestamp))
  ) {
    throw new InvalidLibraryCursorError();
  }

  if (expectedSort === "playlist") {
    if (
      typeof candidate.position !== "number" ||
      !Number.isSafeInteger(candidate.position) ||
      candidate.position < 0
    ) {
      throw new InvalidLibraryCursorError();
    }

    return {
      paperId: candidate.paperId,
      position: candidate.position,
      sort: "playlist",
      timestamp: candidate.timestamp,
      version: 1,
    };
  }

  return {
    paperId: candidate.paperId,
    sort: expectedSort,
    timestamp: candidate.timestamp,
    version: 1,
  };
}
