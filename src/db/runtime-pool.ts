import "server-only";

import { Pool, type PoolConfig } from "pg";
import { logger } from "@/lib/logging/logger";

const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;
const DEFAULT_QUERY_TIMEOUT_MS = 18_000;
const DEFAULT_SLOW_QUERY_MS = 1_000;
const DEFAULT_SLOW_POOL_WAIT_MS = 100;

type RuntimePoolSettings = {
  maxConnections: number;
  statementTimeoutMs: number;
  queryTimeoutMs: number;
  slowQueryMs: number;
  slowPoolWaitMs: number;
};

type RuntimePoolEnvironment = Record<string, string | undefined>;

type RuntimeQuery = (...args: unknown[]) => unknown;
type RuntimeConnect = (...args: unknown[]) => unknown;
type RuntimeCallback = (...args: unknown[]) => void;

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function databaseRuntimeSettings(
  environment: RuntimePoolEnvironment = process.env,
): RuntimePoolSettings {
  const statementTimeoutMs = positiveInteger(
    environment.DATABASE_STATEMENT_TIMEOUT_MS,
    DEFAULT_STATEMENT_TIMEOUT_MS,
  );
  const queryTimeoutMs = Math.max(
    positiveInteger(
      environment.DATABASE_QUERY_TIMEOUT_MS,
      DEFAULT_QUERY_TIMEOUT_MS,
    ),
    statementTimeoutMs + 1_000,
  );

  return {
    maxConnections: positiveInteger(environment.DATABASE_MAX_CONNECTIONS, 1),
    statementTimeoutMs,
    queryTimeoutMs,
    slowQueryMs: positiveInteger(
      environment.DATABASE_SLOW_QUERY_MS,
      DEFAULT_SLOW_QUERY_MS,
    ),
    slowPoolWaitMs: positiveInteger(
      environment.DATABASE_SLOW_POOL_WAIT_MS,
      DEFAULT_SLOW_POOL_WAIT_MS,
    ),
  };
}

function poolFields(pool: Pool) {
  return {
    poolTotal: pool.totalCount,
    poolIdle: pool.idleCount,
    poolWaiting: pool.waitingCount,
  };
}

function querySource() {
  const stack = new Error().stack?.split("\n").slice(1) ?? [];
  const frame = stack.find(
    (line) =>
      (line.includes("/src/app/") || line.includes("/src/lib/")) &&
      !line.includes("/src/lib/logging/") &&
      !line.includes("/src/db/runtime-pool"),
  );

  return frame?.trim().replace(process.cwd(), ".") ?? "unattributed";
}

function isTimeoutError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? error.code : undefined;
  return code === "57014" || error.message === "Query read timeout";
}

function instrumentPoolAcquisition(pool: Pool, settings: RuntimePoolSettings) {
  const originalConnect = pool.connect.bind(pool) as RuntimeConnect;

  (pool as unknown as { connect: RuntimeConnect }).connect = (...args) => {
    const startedAt = performance.now();
    const saturatedAtStart =
      pool.idleCount === 0 && pool.totalCount >= settings.maxConnections;
    const callback = args[0];

    const record = (error?: unknown) => {
      const waitMs = Math.round(performance.now() - startedAt);
      if (
        error === undefined &&
        !saturatedAtStart &&
        waitMs < settings.slowPoolWaitMs
      ) {
        return;
      }

      logger.warn("database_pool_acquire", {
        waitMs,
        saturatedAtStart,
        outcome: error === undefined ? "acquired" : "error",
        ...poolFields(pool),
        ...(error === undefined ? {} : { error }),
      });
    };

    if (typeof callback === "function") {
      return originalConnect((...callbackArgs: unknown[]) => {
        record(callbackArgs[0]);
        (callback as RuntimeCallback)(...callbackArgs);
      });
    }

    const result = originalConnect() as Promise<unknown>;
    return result.then(
      (client) => {
        record();
        return client;
      },
      (error) => {
        record(error);
        throw error;
      },
    );
  };
}

function instrumentQueries(pool: Pool, settings: RuntimePoolSettings) {
  const originalQuery = pool.query.bind(pool) as RuntimeQuery;

  (pool as unknown as { query: RuntimeQuery }).query = (...args) => {
    const startedAt = performance.now();
    const source = querySource();
    const callbackIndex = args.length - 1;
    const callback = args[callbackIndex];
    let recorded = false;

    const record = (error?: unknown) => {
      if (recorded) return;
      recorded = true;
      const durationMs = Math.round(performance.now() - startedAt);
      const timedOut = isTimeoutError(error);

      if (!timedOut && durationMs < settings.slowQueryMs) return;

      logger.warn(timedOut ? "database_query_timeout" : "database_slow_query", {
        source,
        durationMs,
        outcome: error === undefined ? "success" : "error",
        statementTimeoutMs: settings.statementTimeoutMs,
        ...poolFields(pool),
        ...(error === undefined ? {} : { error }),
      });
    };

    if (typeof callback === "function") {
      args[callbackIndex] = (...callbackArgs: unknown[]) => {
        record(callbackArgs[0]);
        (callback as RuntimeCallback)(...callbackArgs);
      };
      return originalQuery(...args);
    }

    const result = originalQuery(...args) as Promise<unknown>;
    return result.then(
      (value) => {
        record();
        return value;
      },
      (error) => {
        record(error);
        throw error;
      },
    );
  };
}

export function createRuntimePool(
  connectionString: string,
  overrides: Partial<RuntimePoolSettings> = {},
) {
  const settings = { ...databaseRuntimeSettings(), ...overrides };
  const config: PoolConfig = {
    connectionString,
    max: settings.maxConnections,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: settings.statementTimeoutMs,
    query_timeout: settings.queryTimeoutMs,
  };
  const pool = new Pool(config);

  instrumentPoolAcquisition(pool, settings);
  instrumentQueries(pool, settings);

  return pool;
}
