import "server-only";

import { randomUUID } from "node:crypto";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

// New operational fields must be explicitly reviewed before they can reach logs.
const scalarFieldNames = new Set([
  "action",
  "durationMs",
  "outcome",
  "poolIdle",
  "poolTotal",
  "poolWaiting",
  "profileEmbeddingReason",
  "profileEmbeddingStatus",
  "profileEmbeddingVectorCount",
  "rankedCount",
  "recommendationBatchItemCount",
  "recommendationStoredCount",
  "saturatedAtStart",
  "source",
  "statementTimeoutMs",
  "storedCount",
  "totalMs",
  "waitMs",
]);

const semanticFieldNames = new Set([
  "candidateCount",
  "catalogFillCount",
  "fallbackReason",
  "matchedCount",
  "model",
  "requestedCount",
  "rpcAttempted",
  "used",
]);

const levelWeights: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function configuredLevel(): LogLevel {
  const level = process.env.LOG_LEVEL;

  if (
    level === "debug" ||
    level === "info" ||
    level === "warn" ||
    level === "error"
  ) {
    return level;
  }

  return "info";
}

function shouldLog(level: LogLevel) {
  return levelWeights[level] >= levelWeights[configuredLevel()];
}

function safeScalar(value: unknown) {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  return undefined;
}

function safeNumberRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    ([key, entry]) =>
      /^[a-z][a-z0-9_]{0,63}$/i.test(key) &&
      typeof entry === "number" &&
      Number.isFinite(entry),
  );
  return Object.fromEntries(entries);
}

function safeSemanticFields(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      const scalar = semanticFieldNames.has(key) ? safeScalar(entry) : undefined;
      return scalar === undefined ? [] : [[key, scalar]];
    }),
  );
}

function sanitizeFields(fields: LogFields) {
  const sanitized: LogFields = {};

  for (const [key, value] of Object.entries(fields)) {
    if (scalarFieldNames.has(key)) {
      const scalar = safeScalar(value);
      if (scalar !== undefined) sanitized[key] = scalar;
      continue;
    }
    if (key === "timings" || key === "candidateSourceCounts") {
      const record = safeNumberRecord(value);
      if (record !== undefined) sanitized[key] = record;
      continue;
    }
    if (key === "semantic") {
      const semantic = safeSemanticFields(value);
      if (semantic !== undefined) sanitized[key] = semantic;
    }
  }

  return sanitized;
}

function errorType(error: Error) {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof SyntaxError) return "SyntaxError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return "Error";
}

function serializeError(error: unknown) {
  if (!(error instanceof Error)) return { type: "UnknownError" };

  const code = "code" in error ? error.code : undefined;
  return {
    type: errorType(error),
    ...(typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)
      ? { code }
      : {}),
  };
}

function writeLog(level: LogLevel, event: string, fields: LogFields = {}) {
  if (!shouldLog(level)) {
    return;
  }

  const { error, ...rest } = fields;
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    eventId: randomUUID(),
    ...sanitizeFields(rest),
    ...(error === undefined ? {} : { error: serializeError(error) }),
  };

  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.info(line);
}

export const logger = {
  debug(event: string, fields?: LogFields) {
    writeLog("debug", event, fields);
  },
  info(event: string, fields?: LogFields) {
    writeLog("info", event, fields);
  },
  warn(event: string, fields?: LogFields) {
    writeLog("warn", event, fields);
  },
  error(event: string, fields?: LogFields) {
    writeLog("error", event, fields);
  },
};
