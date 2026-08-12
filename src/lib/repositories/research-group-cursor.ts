import "server-only";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ResearchGroupPaperCursor = {
  addedAt: string;
  paperId: string;
  version: 1;
};

export class InvalidResearchGroupPaperCursorError extends Error {
  constructor() {
    super("Invalid research-group paper pagination cursor");
    this.name = "InvalidResearchGroupPaperCursorError";
  }
}

export function encodeResearchGroupPaperCursor(
  cursor: ResearchGroupPaperCursor,
) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeResearchGroupPaperCursor(
  value: string | null | undefined,
): ResearchGroupPaperCursor | null {
  if (!value) return null;
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new InvalidResearchGroupPaperCursorError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new InvalidResearchGroupPaperCursorError();
  }

  if (!parsed || typeof parsed !== "object") {
    throw new InvalidResearchGroupPaperCursorError();
  }

  const candidate = parsed as Record<string, unknown>;
  const addedAt =
    typeof candidate.addedAt === "string"
      ? new Date(candidate.addedAt)
      : null;
  if (
    candidate.version !== 1 ||
    typeof candidate.paperId !== "string" ||
    !uuidPattern.test(candidate.paperId) ||
    !addedAt ||
    !Number.isFinite(addedAt.getTime())
  ) {
    throw new InvalidResearchGroupPaperCursorError();
  }

  return {
    addedAt: addedAt.toISOString(),
    paperId: candidate.paperId,
    version: 1,
  };
}
