export type RevisionCursorLike = {
  last_seen_external_id: string | null;
  last_seen_updated_at: string | null;
};

export type RevisionPaperLike = {
  arxivId: string;
  updatedAt: string;
};

type DatabaseErrorLike = {
  cause?: unknown;
  code?: unknown;
  message?: unknown;
};

const transientDatabaseCodes = new Set([
  "40001",
  "40P01",
  "55P03",
  "57014",
  "PGRST000",
  "PGRST001",
  "PGRST002",
  "PGRST003",
]);

export const MAX_REVISION_CATCH_UP_PAGES = 500;

export function nextRevisionPageBudget(
  configuredPages: number,
  storedProgress: string | null | undefined,
  maximumPages = MAX_REVISION_CATCH_UP_PAGES,
) {
  const previousPages = Number(storedProgress);
  if (!Number.isInteger(previousPages) || previousPages < configuredPages) {
    return configuredPages;
  }

  return Math.min(maximumPages, previousPages * 2);
}

export async function collectRevisionPages<T extends RevisionPaperLike>({
  configuredPages,
  cursor,
  fetchPage,
  maxResults,
  storedProgress,
}: {
  configuredPages: number;
  cursor: RevisionCursorLike | null;
  fetchPage: (page: number) => Promise<T[]>;
  maxResults: number;
  storedProgress: string | null | undefined;
}) {
  const fetchedPapers: T[] = [];
  const importablePapers: T[] = [];
  const pageBudget = nextRevisionPageBudget(configuredPages, storedProgress);

  for (let page = 0; page < pageBudget; page += 1) {
    const pagePapers = await fetchPage(page);
    fetchedPapers.push(...pagePapers);
    importablePapers.push(
      ...pagePapers.filter((paper) => isAfterRevisionCursor(paper, cursor)),
    );

    if (
      !cursor?.last_seen_updated_at ||
      pagePapers.length < maxResults ||
      hasPassedRevisionCursorTimestamp(pagePapers, cursor)
    ) {
      return {
        fetchedPapers,
        importablePapers,
        pageBudget,
        revisionComplete: true,
      };
    }
  }

  return {
    fetchedPapers,
    importablePapers,
    pageBudget,
    revisionComplete: false,
  };
}

export function revisionCatchUpCheckpoint(
  cursor: RevisionCursorLike | null,
  pageBudget: number,
) {
  if (!cursor?.last_seen_updated_at) {
    throw new Error("A revision cursor is required to checkpoint catch-up");
  }

  return {
    cursorValue: String(pageBudget),
    lastSeenExternalId: cursor.last_seen_external_id,
    lastSeenUpdatedAt: cursor.last_seen_updated_at,
  };
}

export function parseBoundedPositiveInteger(
  value: number,
  label: string,
  maximum: number,
) {
  return parseIntegerInRange(value, label, 1, maximum);
}

export function parseIntegerInRange(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${label} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return value;
}

export function isAfterRevisionCursor(
  paper: RevisionPaperLike,
  cursor: RevisionCursorLike | null,
) {
  if (!cursor?.last_seen_updated_at) return true;

  const paperTime = new Date(paper.updatedAt).getTime();
  const cursorTime = new Date(cursor.last_seen_updated_at).getTime();
  if (paperTime > cursorTime) return true;
  if (paperTime < cursorTime) return false;
  return cursor.last_seen_external_id
    ? paper.arxivId > cursor.last_seen_external_id
    : false;
}

export function hasPassedRevisionCursorTimestamp(
  papers: RevisionPaperLike[],
  cursor: RevisionCursorLike | null,
) {
  if (!cursor?.last_seen_updated_at) return false;
  const cursorTime = new Date(cursor.last_seen_updated_at).getTime();
  return papers.some(
    (paper) => new Date(paper.updatedAt).getTime() < cursorTime,
  );
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  operation: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await operation(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

export function isTransientDatabaseError(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== "object") return false;
    const candidate = current as DatabaseErrorLike;
    if (
      typeof candidate.code === "string" &&
      transientDatabaseCodes.has(candidate.code)
    ) {
      return true;
    }
    if (
      typeof candidate.message === "string" &&
      /fetch failed|network error|connection (?:closed|reset|terminated)/i.test(
        candidate.message,
      )
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

export async function withWholePaperRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
) {
  const maxRetries = options.maxRetries ?? 2;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxRetries || !isTransientDatabaseError(error)) throw error;
      await sleep(250 * 2 ** attempt);
    }
  }
}

export function createRequestRateGate(
  delayMs: number,
  dependencies: {
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
) {
  const now = dependencies.now ?? Date.now;
  const sleep =
    dependencies.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let lastRequestAt: number | null = null;
  let queue = Promise.resolve();

  return () => {
    const turn = queue.then(async () => {
      if (lastRequestAt !== null) {
        const remaining = delayMs - (now() - lastRequestAt);
        if (remaining > 0) await sleep(remaining);
      }
      lastRequestAt = now();
    });
    queue = turn.catch(() => undefined);
    return turn;
  };
}
