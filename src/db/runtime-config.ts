export type HostedDatabaseConfiguration = {
  environment: "preview" | "production";
  hostKind: "supabase-shared-pooler";
  port: 6543;
  maxConnections: 3;
};

export type RuntimeDatabaseEnvironment = {
  VERCEL?: string;
  VERCEL_ENV?: string;
  DATABASE_URL?: string;
  DATABASE_MAX_CONNECTIONS?: string;
};

function hostedEnvironmentName(
  environment: RuntimeDatabaseEnvironment,
): "preview" | "production" | null {
  if (
    environment.VERCEL === "1" &&
    (environment.VERCEL_ENV === "preview" ||
      environment.VERCEL_ENV === "production")
  ) {
    return environment.VERCEL_ENV;
  }

  return null;
}

export function validateHostedDatabaseConfiguration(
  environment: RuntimeDatabaseEnvironment = {
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_MAX_CONNECTIONS: process.env.DATABASE_MAX_CONNECTIONS,
  },
): HostedDatabaseConfiguration | null {
  const hostedEnvironment = hostedEnvironmentName(environment);
  if (!hostedEnvironment) return null;

  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required on Vercel");
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL on Vercel");
  }

  if (
    parsed.protocol !== "postgres:" &&
    parsed.protocol !== "postgresql:"
  ) {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol on Vercel");
  }

  if (!parsed.hostname.endsWith(".pooler.supabase.com")) {
    throw new Error(
      "DATABASE_URL must use the Supabase shared pooler on Vercel",
    );
  }

  if (parsed.port !== "6543") {
    throw new Error(
      "DATABASE_URL must use Supabase Transaction mode on port 6543 on Vercel",
    );
  }

  if (environment.DATABASE_MAX_CONNECTIONS !== "3") {
    throw new Error("DATABASE_MAX_CONNECTIONS must be 3 on Vercel");
  }

  return {
    environment: hostedEnvironment,
    hostKind: "supabase-shared-pooler",
    port: 6543,
    maxConnections: 3,
  };
}
