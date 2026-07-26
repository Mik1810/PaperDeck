const ARXIV_RATE_LIMIT_BASE_MS = 60_000;
const ARXIV_UPSTREAM_BASE_MS = 5_000;
const ARXIV_RATE_LIMIT_CAP_MS = 240_000;
const ARXIV_UPSTREAM_CAP_MS = 60_000;

function retryAfterMs(value: string | null, nowMs: number) {
  if (!value) {
    return null;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  const dateMs = Date.parse(value);

  if (!Number.isFinite(dateMs) || dateMs <= nowMs) {
    return null;
  }

  return dateMs - nowMs;
}

export function arxivRetryDelayMs(
  status: number,
  attempt: number,
  retryAfter: string | null,
  randomValue = Math.random(),
  nowMs = Date.now(),
) {
  const serverDelayMs = retryAfterMs(retryAfter, nowMs);

  if (serverDelayMs !== null) {
    return serverDelayMs;
  }

  const rateLimited = status === 429;
  const baseMs = rateLimited ? ARXIV_RATE_LIMIT_BASE_MS : ARXIV_UPSTREAM_BASE_MS;
  const capMs = rateLimited ? ARXIV_RATE_LIMIT_CAP_MS : ARXIV_UPSTREAM_CAP_MS;
  const exponentialMs = Math.min(baseMs * 2 ** attempt, capMs);
  const boundedRandom = Math.min(1, Math.max(0, randomValue));
  const jitter = 0.9 + boundedRandom * 0.2;

  return Math.round(exponentialMs * jitter);
}
