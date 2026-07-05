import "server-only";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

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

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { message: String(error) };
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
    ...rest,
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
